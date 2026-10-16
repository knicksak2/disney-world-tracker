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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';

import type { FoodItemDTO, FoodItemsResponseDTO, MenuDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';
import FoodItemPickerModal from './FoodItemPickerModal';
import AddToListsSheet from '../foodLists/AddToListsSheet';
import { MENU_ITEM } from './MenuScreen.palette';

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
  const styles = useStyles();
  const t = useAppTheme();
  const route = useRoute<MenuRouteProp>();
  const navigation = useNavigation();
  const { experienceId } = route.params;
  const encodedId = encodeURIComponent(experienceId);
  const queryClient = useQueryClient();

  const [activeIndex, setActiveIndex] = React.useState(0);
  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [selectedItemsForSheet, setSelectedItemsForSheet] = React.useState<readonly FoodItemDTO[]>([]);

  // Same key + fn as `ExperienceDetailScreen`, so the entry the detail view
  // already fetched is reused here.
  const detailQ = useQuery({
    queryKey: ['experience', experienceId] as const,
    queryFn: () => apiRequest<MenuDetailDTO>('GET', `/catalog/${encodedId}`),
  });

  // Query food items so that we have IDs to add to food lists
  const foodItemsQ = useQuery<FoodItemsResponseDTO>({
    queryKey: ['experience-food-items', experienceId],
    queryFn: () =>
      apiRequest<FoodItemsResponseDTO>(
        'GET',
        `/experiences/${encodedId}/food-items`,
      ),
    staleTime: 60_000,
  });

  const handleAddItemToList = React.useCallback(
    async (item: { name: string; price?: string | null }) => {
      const trimmed = item.name.trim();
      const existing = foodItemsQ.data?.items?.find(
        (fi) => fi.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) {
        setSelectedItemsForSheet([existing]);
        setSheetVisible(true);
        return;
      }

      // If not yet in cache, create or resolve it on-demand
      try {
        const created = await apiRequest<FoodItemDTO>(
          'POST',
          `/experiences/${encodedId}/food-items`,
          { name: trimmed },
        );
        void queryClient.invalidateQueries({
          queryKey: ['experience-food-items', experienceId],
        });
        setSelectedItemsForSheet([created]);
        setSheetVisible(true);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'food_item_duplicate') {
          const existingId = err.details?.['existingId'] as string | undefined;
          const matched =
            (existingId
              ? foodItemsQ.data?.items?.find((i) => i.id === existingId)
              : undefined) ?? {
              id: existingId ?? `item-${trimmed}`,
              experienceId,
              locationId: null,
              name: trimmed,
              price: item.price ?? null,
              source: 'user_submitted' as const,
              currentlyOnMenu: true,
            };
          setSelectedItemsForSheet([matched]);
          setSheetVisible(true);
        }
      }
    },
    [encodedId, experienceId, foodItemsQ.data?.items, queryClient],
  );

  // Deep-link defensive path: nothing cached yet and the fetch is in flight.
  if (detailQ.isLoading) {
    return (
      <ScreenContainer>
        <GradientHeader title="Menu" icon="restaurant" compact onBack={() => navigation.goBack()} />
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color={t.color.primaryFg} />
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
      {/* Header: restaurant name + back control (R5.8, R5.9) + Add to List action (R5.10) */}
      <GradientHeader
        title={detail.name}
        subtitle="Menu"
        icon="restaurant"
        compact
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            testID="menu-screen-add-to-list-btn"
            accessibilityRole="button"
            accessibilityLabel="Add dishes to a food list"
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [
              styles.headerActionBtn,
              pressed && styles.headerActionBtnPressed,
            ]}
          >
            <Ionicons name="bookmark-outline" size={15} color={t.color.textOnPrimary} />
            <Text style={styles.headerActionBtnText}>Add to List</Text>
          </Pressable>
        }
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
          <MenuBlock
            menu={menus[safeActive]!}
            index={safeActive}
            onAddItem={handleAddItemToList}
          />
        )}
      </ScrollView>

      {/* Food item picker modal in addToLists mode */}
      <FoodItemPickerModal
        experienceId={experienceId}
        menus={menus}
        mode="addToLists"
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onConfirmSelection={(items) => {
          setSelectedItemsForSheet(items);
          setPickerVisible(false);
          setSheetVisible(true);
        }}
      />

      {/* Add to Lists Sheet */}
      <AddToListsSheet
        visible={sheetVisible}
        foodItems={selectedItemsForSheet}
        onClose={() => {
          setSheetVisible(false);
          setSelectedItemsForSheet([]);
        }}
      />
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
  const styles = useStyles();
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
  onAddItem,
}: {
  readonly menu: MenuDTO;
  readonly index: number;
  readonly onAddItem?: (item: { name: string; price?: string | null }) => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const hasCuisine = typeof menu.cuisineType === 'string' && menu.cuisineType.length > 0;

  return (
    <Card style={styles.menuCard} testID={`menu-block-${index}`}>
      <SectionLabel>{menu.menuType}</SectionLabel>
      <View style={styles.badgeRow}>
        <Badge label={menu.menuType} color={t.color.primaryFg} icon="restaurant" testID={`menu-type-${index}`} />
        {hasCuisine ? (
          <Badge
            label={menu.cuisineType as string}
            color={t.color.accent}
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
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {hasPrice ? (
                    <Text style={styles.itemPrice} testID={`menu-item-price-${index}-${groupIndex}-${itemIndex}`}>
                      {item.price as string}
                    </Text>
                  ) : null}
                </View>
                {onAddItem ? (
                  <Pressable
                    onPress={() => onAddItem(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.name} to food list`}
                    style={({ pressed }) => [styles.itemAddBtn, pressed && styles.itemAddBtnPressed]}
                    testID={`menu-item-add-to-list-${index}-${groupIndex}-${itemIndex}`}
                    hitSlop={8}
                  >
                    <Ionicons name="bookmark-outline" size={16} color={t.color.primaryFg} />
                  </Pressable>
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

const useStyles = makeStyles((t) => ({
  container: {
    padding: t.spacing.lg,
    paddingBottom: t.spacing.xxl,
    gap: t.spacing.md,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
    gap: t.spacing.sm,
  },
  tabBar: {
    paddingTop: t.spacing.sm,
  },
  tabBarContent: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xs,
    gap: t.spacing.sm,
  },
  tab: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  tabActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  tabInactive: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.border,
  },
  tabText: {
    ...t.typography.subtitle,
  },
  tabTextActive: {
    color: t.color.textOnPrimary,
  },
  tabTextInactive: {
    color: t.color.textSecondary,
  },
  menuCard: {
    gap: t.spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    flexWrap: 'wrap',
    marginBottom: t.spacing.sm,
  },
  group: {
    marginTop: t.spacing.sm,
    gap: t.spacing.xs,
  },
  groupName: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
    marginBottom: t.spacing.xs,
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  headerActionBtnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  headerActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  itemInfo: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flex: 1,
    gap: t.spacing.md,
  },
  itemName: {
    ...t.typography.body,
    color: t.color.textPrimary,
    flexShrink: 1,
    flexGrow: 1,
  },
  itemPrice: {
    ...t.typography.body,
    color: t.color.textSecondary,
    flexShrink: 0,
  },
  itemAddBtn: {
    padding: 6,
    marginLeft: 8,
    borderRadius: 8,
    backgroundColor: MENU_ITEM[t.scheme].addBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemAddBtnPressed: {
    opacity: 0.7,
    backgroundColor: MENU_ITEM[t.scheme].addBgPressed,
  },
}));
