// Feature: restaurant-menu-display, Task 5.1 — Menu_Summary_Card
//
// Validates: Requirements R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7
//
// A compact themed card rendered inside the Experience detail scroll view for a
// Restaurant_Experience. Its render is a pure function of the detail query
// state (loading / error / loaded) and the Experience category:
//
//   - non-restaurant                → renders nothing (R4.6)
//   - restaurant + detail loading   → an ActivityIndicator, no card content (R4.3)
//   - restaurant + detail error     → nothing; the screen's top-level error
//                                      indicator already handles it (R4.5)
//   - restaurant + menus present    → a `Card` with a `SectionLabel` "Menus",
//                                      the menu count, and a `Badge` per menu
//                                      type; the whole card is pressable and
//                                      navigates to the Menu_Screen (R4.1, R4.2)
//   - restaurant + no menus         → an `EmptyState` "No menu available" with
//                                      no press target / no navigation (R4.4)
//
// It uses the shared Magical / Whimsical theme primitives (Card, SectionLabel,
// Badge, EmptyState) so it matches the other detail sections (R4.7).

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { ExperienceCategory, MenuDTO } from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import { Badge, Card, EmptyState, SectionLabel } from '../../theme/components';
import { summarizeMenus } from './menuSummary';

/**
 * Navigation prop shape the card needs: it only ever navigates to the `Menu`
 * route, so accepting the detail screen's navigation prop keeps the call
 * `navigation.navigate('Menu', { experienceId })` fully typed against
 * `RootStackParamList`.
 */
type MenuNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'ExperienceDetail'
>;

export interface MenuSummaryCardProps {
  /** The Experience's category; the card renders only for `Restaurant` (R4.6). */
  readonly category: ExperienceCategory;
  /**
   * The detail response's `menus` field. `undefined` both while the detail is
   * loading and when the restaurant simply has no menus available; the
   * `isLoading` flag disambiguates the two so the loading and empty renders
   * stay distinct (R4.3 vs. R4.4).
   */
  readonly menus: readonly MenuDTO[] | undefined;
  /** Detail query pending — render a loading indicator in place of the card (R4.3). */
  readonly isLoading: boolean;
  /** Detail query errored — render nothing; the screen shows its own error (R4.5). */
  readonly isError: boolean;
  /** The Restaurant_Experience id; forwarded to the Menu_Screen on tap (R4.2). */
  readonly experienceId: string;
  /** Detail screen navigation, used to open the Menu_Screen on tap (R4.2). */
  readonly navigation: MenuNavigationProp;
}

/**
 * The Menu_Summary_Card. See the module header for the full render-state
 * matrix. Returns `null` for the non-restaurant and error cases so nothing is
 * inserted into the detail scroll view.
 */
export default function MenuSummaryCard({
  category,
  menus,
  isLoading,
  isError,
  experienceId,
  navigation,
}: MenuSummaryCardProps): JSX.Element | null {
  // R4.6: the card exists only for restaurants — every other category renders
  // nothing and offers no navigation to the Menu_Screen.
  if (category !== 'Restaurant') {
    return null;
  }

  // R4.3: while the detail is loading, show a loading indicator in place of the
  // card and render no card content.
  if (isLoading) {
    return (
      <Card style={styles.section} testID="menu-summary-loading">
        <ActivityIndicator
          accessibilityLabel="Loading menus"
          color={theme.color.primary}
        />
      </Card>
    );
  }

  // R4.5: on a detail load failure the screen already surfaces its top-level
  // error indicator, so the card renders nothing.
  if (isError) {
    return null;
  }

  const summary = summarizeMenus(menus ?? []);

  // R4.4: a restaurant with no menus renders an empty state (no press target),
  // so there is no navigation to the Menu_Screen.
  if (summary.count === 0) {
    return (
      <Card style={styles.section} testID="menu-summary-empty">
        <SectionLabel>Menus</SectionLabel>
        <EmptyState
          icon="restaurant-outline"
          title="No menu available"
          testID="menu-summary-empty-state"
        />
      </Card>
    );
  }

  // R4.1 / R4.2: menus present — a pressable card summarizing the available
  // menus (count + a Badge per menu type) that navigates to the Menu_Screen.
  return (
    <Card
      style={styles.section}
      onPress={() => navigation.navigate('Menu', { experienceId })}
      accessibilityRole="button"
      accessibilityLabel={`View menus, ${summary.count} ${
        summary.count === 1 ? 'menu' : 'menus'
      } available`}
      testID="menu-summary-card"
    >
      <SectionLabel>Menus</SectionLabel>
      <Text style={styles.count} testID="menu-summary-count">
        {summary.count} {summary.count === 1 ? 'menu' : 'menus'} available
      </Text>
      <View style={styles.badgeRow}>
        {summary.menuTypes.map((menuType, index) => (
          <Badge
            key={`${menuType}-${index}`}
            label={menuType}
            color={theme.color.primary}
            icon="restaurant"
            testID={`menu-summary-type-${index}`}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: theme.spacing.md,
  },
  count: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
});
