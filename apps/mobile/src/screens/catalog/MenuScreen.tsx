// Feature: restaurant-menu-display, Task 6.1 — dedicated Menu_Screen (tabbed)
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
//
// Behavior summary:
//   - Reads the *already-fetched* Experience detail from the shared React
//     Query cache under the same key/fn as the detail screen
//     (`['experience', experienceId]` → `GET /catalog/:experienceId`), so the
//     menus laid out here reuse the detail view's fetch without a second
//     network round trip and without re-deriving order (R5.1, R5.2).
//   - Renders a `GradientHeader` carrying the restaurant name plus a back
//     control that invokes `navigation.goBack` (R5.8, R5.9).
//   - When a restaurant offers more than one menu, renders a horizontal TAB BAR
//     with one tab per menu type (in provided order, R5.2, R5.3) so the user
//     switches between menus instead of scrolling through all of them. The
//     selected menu is rendered as a themed `Card`, labelled by its menu type
//     via a `SectionLabel` + `Badge`, with the cuisine type surfaced alongside
//     as a second `Badge` only when present (R5.4, R5.5). A single-menu
//     restaurant shows no tab bar (the one menu renders directly).
//   - Within the selected menu, every group renders by name and every item in
//     index order, preserving the provided order (R5.1, R5.2). Each item shows
//     its name plus its price string verbatim when non-empty, and the name
//     alone when the price is absent or empty (R5.6, R5.7).
//   - Provides loading / error / empty fallbacks for an unpopulated
//     `['experience', id]` query (deep-link defensive paths).
//
// Styling: uses the shared "Magical / Whimsical" theme primitives
// (`GradientHeader`, `Card`, `SectionLabel`, `Badge`, `EmptyState`,
// `ScreenContainer`) plus theme-token-styled tab pills so the layout matches
// the other detail sections (R5.9). See `theme/theme.ts` and `theme/components`.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';

import type { MenuDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The subset of `GET /catalog/:experienceId` the Menu_Screen needs. Because
 * both screens key the query on `['experience', experienceId]`, the cached
 * entry populated by the detail screen is served here directly.
 */
interface MenuDetailDTO {
  readonly id: string;
  readonly name: string;
  readonly menus?: readonly MenuDTO[];
}

type MenuRouteProp = RouteProp<{ Menu: { experienceId: string } }, 'Menu'>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MenuScreen(): JSX.Element {
  const route = useRoute<MenuRouteProp>();
  const navigation = useNavigation();
  const { experienceId } = route.params;
  const encodedId = encodeURIComponent(experienceId);

  const [activeIndex, setActiveIndex] = React.useState(0);

  // Same key + fn as `ExperienceDetailScreen`, so the entry the detail view
  // already fetched is reused here.
  const detailQ = useQuery({
    queryKey: ['experience', experienceId] as const,
    queryFn: () => apiRequest<MenuDetailDTO>('GET', `/catalog/${encodedId}`),
  });

  // Deep-link defensive path: nothing cached yet and the fetch is in flight.
  if (detailQ.isLoading) {
    return (
      <ScreenContainer>
        <GradientHeader title="Menu" icon="restaurant" compact onBack={() => navigation.goBack()} />
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // Deep-link defensive path: the detail read failed.
  if (detailQ.isError || detailQ.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Menu" icon="restaurant" compact onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <EmptyState
            icon="alert-circle-outline"
            title="We couldn't load this menu"
            body="Please try again later."
            testID="menu-error"
          />
        </View>
      </ScreenContainer>
    );
  }

  const detail = detailQ.data;
  const menus = detail.menus ?? [];
  // Clamp the selected tab in case the cached menu list changed underneath us.
  const safeActive = activeIndex >= 0 && activeIndex < menus.length ? activeIndex : 0;

  return (
    <ScreenContainer>
      {/* Header: restaurant name + back control (R5.8, R5.9). */}
      <GradientHeader
        title={detail.name}
        subtitle="Menu"
        icon="restaurant"
        compact
        onBack={() => navigation.goBack()}
      />

      {/* Tab bar: one tab per menu type, only when there's more than one menu
          (R5.2, R5.3). A single menu renders directly with no tabs. */}
      {menus.length > 1 ? (
        <MenuTabs
          labels={menus.map((menu) => menu.menuType)}
          activeIndex={safeActive}
          onSelect={setActiveIndex}
        />
      ) : null}

      <ScrollView contentContainerStyle={styles.container} testID="menu-screen">
        {menus.length === 0 ? (
          // Defensive empty state: normal navigation from the summary card only
          // reaches this screen when menus are present.
          <Card>
            <EmptyState
              icon="restaurant-outline"
              title="No menu available"
              body="This restaurant has no menu to show right now."
              testID="menu-empty"
            />
          </Card>
        ) : (
          // Only the selected menu is rendered (tabbed navigation), labelled by
          // its own index so per-menu testIDs stay stable.
          <MenuBlock menu={menus[safeActive]!} index={safeActive} />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

/**
 * Horizontal, scrollable tab bar of menu-type pills. Purely presentational and
 * theme-token styled (not the `Badge` primitive, so it does not perturb the
 * per-menu badge structure). The active pill is filled with the brand primary;
 * inactive pills use the subtle alt surface.
 */
function MenuTabs({
  labels,
  activeIndex,
  onSelect,
}: {
  readonly labels: readonly string[];
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
}): JSX.Element {
  return (
    <View style={styles.tabBar} testID="menu-tabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarContent}
      >
        {labels.map((label, index) => {
          const active = index === activeIndex;
          return (
            <Pressable
              key={index}
              testID={`menu-tab-${index}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              onPress={() => onSelect(index)}
              style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
            >
              <Text
                numberOfLines={1}
                style={[styles.tabText, active ? styles.tabTextActive : styles.tabTextInactive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-menu block
// ---------------------------------------------------------------------------

/**
 * A single menu rendered as a themed `Card`: the menu type as a `SectionLabel`
 * and a `Badge`, the cuisine type as a second `Badge` only when present (R5.3,
 * R5.4, R5.5), then every group and item in index order (R5.1, R5.2).
 */
function MenuBlock({
  menu,
  index,
}: {
  readonly menu: MenuDTO;
  readonly index: number;
}): JSX.Element {
  const hasCuisine = typeof menu.cuisineType === 'string' && menu.cuisineType.length > 0;

  return (
    <Card style={styles.menuCard} testID={`menu-block-${index}`}>
      <SectionLabel>{menu.menuType}</SectionLabel>
      <View style={styles.badgeRow}>
        <Badge label={menu.menuType} color={theme.color.primary} icon="restaurant" testID={`menu-type-${index}`} />
        {hasCuisine ? (
          <Badge
            label={menu.cuisineType as string}
            color={theme.color.accent}
            icon="pricetag"
            testID={`menu-cuisine-${index}`}
          />
        ) : null}
      </View>

      {menu.groups.map((group, groupIndex) => (
        <View key={groupIndex} style={styles.group} testID={`menu-group-${index}-${groupIndex}`}>
          <Text style={styles.groupName}>{group.name}</Text>
          {group.items.map((item, itemIndex) => {
            const hasPrice = typeof item.price === 'string' && item.price.length > 0;
            return (
              <View
                key={itemIndex}
                style={styles.itemRow}
                testID={`menu-item-${index}-${groupIndex}-${itemIndex}`}
              >
                <Text style={styles.itemName}>{item.name}</Text>
                {hasPrice ? (
                  <Text style={styles.itemPrice} testID={`menu-item-price-${index}-${groupIndex}-${itemIndex}`}>
                    {item.price as string}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  tabBar: {
    paddingTop: theme.spacing.sm,
  },
  tabBarContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  tab: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  tabActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  tabInactive: {
    backgroundColor: theme.color.surfaceAlt,
    borderColor: theme.color.border,
  },
  tabText: {
    ...theme.typography.subtitle,
  },
  tabTextActive: {
    color: theme.color.textOnPrimary,
  },
  tabTextInactive: {
    color: theme.color.textSecondary,
  },
  menuCard: {
    gap: theme.spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
    marginBottom: theme.spacing.sm,
  },
  group: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  groupName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  itemName: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    flexShrink: 1,
    flexGrow: 1,
  },
  itemPrice: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    flexShrink: 0,
  },
});
