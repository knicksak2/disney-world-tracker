import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
} from 'react-native-draggable-flatlist';
import type { RenderItemParams } from 'react-native-draggable-flatlist';
import type {
  ExperienceCategory,
  ExperienceDTO,
  ExperienceListDetailDTO,
  ExperienceListItemDTO,
  VisitSummaryDTO,
  VisitSummaryResponseDTO,
} from '@dwt/shared';
import { EXPERIENCE_CATEGORIES } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme, categoryVisual } from '../../theme/theme';
import { Badge, Card, GradientHeader, ScreenContainer } from '../../theme/components';
import { useOpenExperience } from '../navigation/experienceNavigation';
import LogVisitModal from '../catalog/LogVisitModal';
import ManageExperienceListSharesSheet from './ManageExperienceListSharesSheet';
import { useExperienceListNotice } from './experienceListNotice';

// ---------------------------------------------------------------------------
// "Add items" catalog search (Requirement 9.5, Entry Point 2)
// ---------------------------------------------------------------------------

/**
 * Every Experience_Category except `Restaurant` — Requirement 9.5 scopes
 * Entry Point 2's catalog search to non-dining categories, mirroring the
 * dining-exclusion rule already enforced server-side (Requirement 2.3) and
 * client-side on Entry Point 1 (`ExperienceDetailScreen.tsx`'s
 * `category !== 'Restaurant'` gate).
 */
const NON_RESTAURANT_CATEGORIES: readonly ExperienceCategory[] =
  EXPERIENCE_CATEGORIES.filter((c) => c !== 'Restaurant');

/** Minimum non-whitespace characters before a search fires — mirrors `ExperiencePicker`'s `SEARCH_MIN_CHARS`. */
const ADD_ITEMS_SEARCH_MIN_CHARS = 2;

/** Debounce applied to the search box — mirrors `ExperiencePicker`'s `SEARCH_DEBOUNCE_MS`. */
const ADD_ITEMS_SEARCH_DEBOUNCE_MS = 300;

/** Wire shape of `GET /catalog` — only the field this control reads. */
interface AddItemsCatalogSearchResponse {
  readonly experiences: readonly ExperienceDTO[];
}

/**
 * The catalog search-and-add step rendered inside `ExperienceListDetailScreen`'s
 * "Add items" modal. Unlike `ExperiencePicker` (which lets the caller choose
 * among the Trip's own Planned_List categories via tabs), this control has a
 * single, fixed scope — every category except `Restaurant` — and no tab UI,
 * since Requirement 9.5 requires the target Experience_List to already be
 * determined with no second list-selection (or category-selection) step.
 *
 * Tapping a result adds it directly to `experienceListId` via
 * `POST /me/experience-lists/:id/items`, swallowing
 * `experience_list_item_duplicate` (Requirement 9.4's pattern, reused here
 * since Entry Point 2 can also target an Experience already on the list).
 */
function AddItemsCatalogSearch({
  experienceListId,
  existingExperienceIds,
  onAdded,
}: {
  readonly experienceListId: string;
  readonly existingExperienceIds: ReadonlySet<string>;
  readonly onAdded: () => void;
}): JSX.Element {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, ADD_ITEMS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const searchActive = debouncedQuery.length >= ADD_ITEMS_SEARCH_MIN_CHARS;

  const searchQuery = useQuery<AddItemsCatalogSearchResponse, ApiError>({
    queryKey: ['catalog', 'search', 'experience-list-add-items', debouncedQuery] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('categories', NON_RESTAURANT_CATEGORIES.join(','));
      params.append('q', debouncedQuery);
      return apiRequest<AddItemsCatalogSearchResponse>('GET', `/catalog?${params.toString()}`);
    },
    enabled: searchActive,
  });

  const results = searchQuery.data?.experiences ?? [];

  async function handleAdd(experience: ExperienceDTO): Promise<void> {
    if (pendingId) return;
    setErrorNotice(null);
    setPendingId(experience.id);
    try {
      await apiRequest('POST', `/me/experience-lists/${encodeURIComponent(experienceListId)}/items`, {
        experienceId: experience.id,
      });
      setAddedIds((prev) => new Set(prev).add(experience.id));
      onAdded();
    } catch (err) {
      // Requirement 9.4's swallow pattern: a duplicate add is treated as
      // already-satisfied, not an error, and still reflected as "added" so
      // the row shows the same disabled/added state either way.
      if (err instanceof ApiError && err.code === 'experience_list_item_duplicate') {
        setAddedIds((prev) => new Set(prev).add(experience.id));
        onAdded();
      } else {
        setErrorNotice('Could not add that item. Please try again.');
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <View style={styles.addItemsSearchWrap} testID="experience-list-add-items-search">
      <View style={styles.addItemsSearchInputWrap}>
        <Ionicons name="search" size={18} color={theme.color.textSecondary} />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search rides, shows, and more..."
          placeholderTextColor={theme.color.textSecondary}
          style={styles.addItemsSearchInput}
          testID="experience-list-add-items-search-input"
        />
        {searchInput.length > 0 ? (
          <Pressable
            onPress={() => {
              setSearchInput('');
              setDebouncedQuery('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search text"
            testID="experience-list-add-items-clear-btn"
            style={styles.clearSearchBtn}
          >
            <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {errorNotice ? (
        <Text style={styles.addItemsErrorText} testID="experience-list-add-items-error">
          {errorNotice}
        </Text>
      ) : null}

      {!searchActive ? (
        <Text style={styles.addItemsHintText} testID="experience-list-add-items-hint">
          Type at least {ADD_ITEMS_SEARCH_MIN_CHARS} characters to search rides, shows, and more
          (restaurants aren&apos;t added here).
        </Text>
      ) : searchQuery.isLoading ? (
        <ActivityIndicator color={theme.color.primary} style={styles.addItemsLoading} />
      ) : results.length === 0 ? (
        <Text style={styles.addItemsHintText} testID="experience-list-add-items-empty">
          No matching experiences found.
        </Text>
      ) : (
        <View testID="experience-list-add-items-results">
          {results.map((experience) => {
            const alreadyOnList = existingExperienceIds.has(experience.id) || addedIds.has(experience.id);
            const visual =
              experience.category in categoryVisual
                ? categoryVisual[experience.category as keyof typeof categoryVisual]
                : { label: experience.category, tint: theme.color.textSecondary };
            return (
              <Pressable
                key={experience.id}
                onPress={() => void handleAdd(experience)}
                disabled={alreadyOnList || pendingId !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: alreadyOnList || pendingId !== null }}
                accessibilityLabel={
                  alreadyOnList ? `${experience.name}, already on list` : `Add ${experience.name}`
                }
                style={({ pressed }) => [
                  styles.addItemsResultRow,
                  pressed && !alreadyOnList && styles.addItemsResultRowPressed,
                  alreadyOnList && styles.addItemsResultRowDisabled,
                ]}
                testID={`experience-list-add-items-result-${experience.id}`}
              >
                <View style={styles.addItemsResultText}>
                  <Text style={styles.addItemsResultName} numberOfLines={2}>
                    {experience.name}
                  </Text>
                  <View style={styles.addItemsResultBadges}>
                    <Badge label={visual.label} color={visual.tint} />
                    {experience.park !== null ? (
                      <Badge label={experience.park} color={theme.color.primary} />
                    ) : null}
                  </View>
                </View>
                {pendingId === experience.id ? (
                  <ActivityIndicator color={theme.color.primary} />
                ) : alreadyOnList ? (
                  <Text style={styles.addItemsAddedTag}>Added</Text>
                ) : (
                  <Ionicons name="add-circle-outline" size={22} color={theme.color.primary} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export interface ExperienceListDetailParams {
  readonly experienceListId: string;
}

type ExperienceListDetailRouteProp = RouteProp<
  { ExperienceListDetail: ExperienceListDetailParams },
  'ExperienceListDetail'
>;

export default function ExperienceListDetailScreen(): JSX.Element {
  const route = useRoute<ExperienceListDetailRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const openExperience = useOpenExperience();
  const { experienceListId } = route.params;
  const queryClient = useQueryClient();

  const [isLiking, setIsLiking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingPinned, setIsTogglingPinned] = useState(false);
  const [staleWriteNotice, setStaleWriteNotice] = useState<string | null>(null);
  const [manageSharesVisible, setManageSharesVisible] = useState(false);
  // Drives the "Add items" modal (Requirement 9.5, Entry Point 2), whose
  // body is the `AddItemsCatalogSearch` catalog search step below.
  const [addItemsModalVisible, setAddItemsModalVisible] = useState(false);
  // Task 13.4: the experienceId currently targeted by the per-row "Log a
  // visit" action, or null when no `LogVisitModal` should be shown. Mirrors
  // `LiveWaitsScreen.tsx`'s `activeLogExperienceId` pattern — a single modal
  // instance conditionally rendered per-id, rather than one modal per row.
  const [loggingExperienceId, setLoggingExperienceId] = useState<string | null>(null);

  const transientNotice = useExperienceListNotice();

  const listQuery = useQuery<ExperienceListDetailDTO>({
    queryKey: ['experience-list-detail', experienceListId],
    queryFn: () =>
      apiRequest<ExperienceListDetailDTO>(
        'GET',
        `/experience-lists/${encodeURIComponent(experienceListId)}`,
      ),
  });

  const list = listQuery.data;

  // Task 13.1: batched visit-summary fetch for every currently-visible item,
  // issued ONCE per render of the item set (not one request per item) via
  // `GET /me/experiences/visit-summary?ids=<comma-joined experienceIds>`,
  // mirroring `ParkPassportCard.tsx`'s call pattern onto the same endpoint.
  // Keyed on `list.version` (bumped by both `addItem` and `removeItem`, per
  // `experienceLists/repo.ts`) rather than a derived/sorted id string, so the
  // query naturally refetches whenever the visible item set changes without
  // needing to recompute a stable string key from the array on every render.
  const visitSummaryQuery = useQuery<VisitSummaryResponseDTO>({
    queryKey: ['experience-list-visit-summary', experienceListId, list?.version] as const,
    queryFn: () => {
      const ids = (list?.items ?? []).map((i) => i.experienceId).join(',');
      return apiRequest<VisitSummaryResponseDTO>(
        'GET',
        `/me/experiences/visit-summary?ids=${encodeURIComponent(ids)}`,
      );
    },
    enabled: (list?.items.length ?? 0) > 0,
  });

  // Enrichment only — never blocks or throws into row rendering. Rows render
  // their existing content regardless of this query's loading/error state;
  // tasks 13.2+ will consume this lookup for badges/sections.
  const visitSummaryByExperienceId = useMemo<ReadonlyMap<string, VisitSummaryDTO>>(() => {
    const data = visitSummaryQuery.data;
    if (!data) return new Map();
    return new Map(Object.entries(data));
  }, [visitSummaryQuery.data]);
  // Task 13.2: default used for any item absent from the lookup (e.g. while
  // `visitSummaryQuery` is still loading), so the row renders the
  // not-yet-done/no-badge state rather than flashing into an inconsistent
  // one once data arrives — consistent with 13.1's enrichment-only,
  // non-blocking contract.
  const DEFAULT_VISIT_SUMMARY: VisitSummaryDTO = {
    repeatCount: 0,
    ratedCount: 0,
    averageRating: null,
  };

  // Requirement 11.2: attribution label shown ONLY when the list has 2+
  // distinct contributors among its items.
  const showAttribution = useMemo(() => {
    if (!list || !list.items) return false;
    const contributorIds = new Set(
      list.items.map((i) => i.addedByUserId).filter((id): id is string => Boolean(id)),
    );
    return contributorIds.size >= 2;
  }, [list]);

  // Requirement 9.5: ids already on this list, so the "Add items" catalog
  // search can render them as disabled/already-added rather than letting the
  // User attempt a needless re-add (the API's duplicate-swallow is a safety
  // net, not the primary UX here).
  const existingExperienceIds = useMemo(
    () => new Set((list?.items ?? []).map((i) => i.experienceId)),
    [list],
  );

  function handleItemAdded(): void {
    void queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
  }

  async function handleToggleLike(): Promise<void> {
    if (!list || isLiking) return;
    setIsLiking(true);
    try {
      if (list.liked) {
        await apiRequest('DELETE', `/experience-lists/${encodeURIComponent(experienceListId)}/like`);
      } else {
        await apiRequest('POST', `/experience-lists/${encodeURIComponent(experienceListId)}/like`);
      }
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsLiking(false);
    }
  }

  // No unsave endpoint exists (per task 6.1) — once saved, `list.saved`
  // disables further taps rather than toggling off.
  async function handleSave(): Promise<void> {
    if (!list || isSaving || list.myRole === 'owner' || list.saved) return;
    setIsSaving(true);
    try {
      await apiRequest('POST', `/experience-lists/${encodeURIComponent(experienceListId)}/save`);
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsSaving(false);
    }
  }

  // Requirement 19.6: owner can toggle list pin state from the detail screen
  async function handleTogglePinned(): Promise<void> {
    if (!list || isTogglingPinned || list.myRole !== 'owner') return;
    setIsTogglingPinned(true);
    try {
      await apiRequest('PATCH', `/me/experience-lists/${encodeURIComponent(experienceListId)}`, {
        pinned: list.pinnedAt === null,
      });
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'experience_list_pin_limit_reached') {
        Alert.alert(
          'Pin Limit Reached',
          'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
        );
      }
    } finally {
      setIsTogglingPinned(false);
    }
  }

  async function handleDeleteItem(experienceId: string): Promise<void> {
    try {
      await apiRequest(
        'DELETE',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/items/${encodeURIComponent(experienceId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
    } catch {
      // Ignore
    }
  }

  // Task 12.3: submit expectedVersion alongside experienceIds on every
  // drag-reorder; on experience_list_stale_write, refetch and show a brief
  // "list was updated" message (Requirement 11.3).
  async function handleReorderItems(newItems: readonly ExperienceListItemDTO[]): Promise<void> {
    if (!list) return;
    setStaleWriteNotice(null);

    const experienceIds = newItems.map((i) => i.experienceId);
    try {
      await apiRequest(
        'PUT',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/items/order`,
        {
          experienceIds,
          expectedVersion: list.version,
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'experience_list_stale_write') {
        await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', experienceListId] });
        setStaleWriteNotice('List was updated by another collaborator. Refreshed.');
      }
    }
  }

  function handleDragEnd({ data }: { data: readonly ExperienceListItemDTO[] }): void {
    void handleReorderItems(data);
  }

  // Task 13.3: "Not yet done" / "Done" sectioning, derived PURELY from
  // `repeatCount > 0` (Requirement 13.4) — no stored flag, no manual toggle.
  // This is a purely presentational split: `list.items` itself is never
  // reordered or partitioned into two arrays. The single
  // `NestableDraggableFlatList` below still renders the FULL `list.items`
  // array in its existing `position` order, with the exact same `data`,
  // `keyExtractor`, and `onDragEnd` → `handleReorderItems` contract as
  // before (task 12.3) — so the full, correctly-ordered `experienceIds`
  // array is always what gets submitted to
  // `PUT /me/experience-lists/:id/items/order`, with no merge-of-partitions
  // problem to solve. Instead, `renderDraggableItem` below detects, from
  // each row's own index within the still-fully-ordered array, whether that
  // row is the FIRST done item encountered in iteration order, and — if so —
  // renders a "Done (n)" section heading immediately above that row's Card,
  // mirroring `TripPlannedListScreen`'s `doneSection`/`doneHeading` visual
  // pattern (testID/style names scoped to this screen, not reused verbatim).
  const isItemDone = useCallback(
    (item: ExperienceListItemDTO): boolean => {
      const visitSummary =
        visitSummaryByExperienceId.get(item.experienceId) ?? DEFAULT_VISIT_SUMMARY;
      return visitSummary.repeatCount > 0;
    },
    [visitSummaryByExperienceId],
  );

  // Index of the first "done" item within `list.items`'s existing order, or
  // -1 when there are none — used only to decide where to render the "Done"
  // section heading; never used to reorder or split the underlying array.
  const firstDoneIndex = useMemo(() => {
    if (!list) return -1;
    return list.items.findIndex((item) => isItemDone(item));
  }, [list, isItemDone]);

  const doneItemCount = useMemo(() => {
    if (!list) return 0;
    return list.items.reduce((count, item) => (isItemDone(item) ? count + 1 : count), 0);
  }, [list, isItemDone]);

  // Stable `renderItem` identity — see `FoodListDetailScreen.tsx`'s
  // `renderDraggableItem` for why an inline arrow literal here would force
  // unnecessary re-render/re-measure work on the visible rows.
  const renderDraggableItem = useCallback(
    (params: RenderItemParams<ExperienceListItemDTO>) => {
      const { item, drag, isActive, getIndex } = params;
      // `canEdit` is normally derived after the loading/unavailable early
      // returns narrow `list` to non-null, but this callback must be
      // declared before those early returns to satisfy the Rules of Hooks —
      // so it re-derives from the raw, possibly-undefined `list` query data.
      const canEdit = list?.myRole === 'owner' || list?.myRole === 'editor';
      // Task 13.2: three badge states derived from the visit-summary lookup
      // built in task 13.1 (Requirement 13.3). Defaults to the not-yet-done
      // state for any item not yet present in the lookup (still loading).
      const visitSummary =
        visitSummaryByExperienceId.get(item.experienceId) ?? DEFAULT_VISIT_SUMMARY;
      const { repeatCount, ratedCount, averageRating } = visitSummary;
      const isDone = repeatCount > 0;
      // Task 13.3: this row is the first "done" row in the array's existing
      // order, so render the "Done (n)" heading immediately above it.
      const showDoneHeading = isDone && getIndex() === firstDoneIndex;
      return (
        <View>
          {showDoneHeading ? (
            <View style={styles.doneSection} testID="experience-list-done-section">
              <Text style={styles.doneHeading}>Done ({doneItemCount})</Text>
            </View>
          ) : null}
          <Card
            style={[styles.itemCard, isActive && styles.itemCardDragging]}
            testID={`experience-list-item-row-${item.experienceId}`}
          >
            <View style={styles.itemCardMain}>
              {canEdit ? (
                <Pressable
                  onLongPress={drag}
                  disabled={isActive}
                  style={styles.dragHandle}
                  accessibilityRole="button"
                  accessibilityLabel={`Drag to reorder ${item.name}`}
                  testID={`experience-list-item-drag-handle-${item.experienceId}`}
                >
                  <Ionicons
                    name="reorder-three"
                    size={22}
                    color={theme.color.textSecondary}
                  />
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => openExperience(item.experienceId)}
                style={({ pressed }) => [
                  styles.itemDetails,
                  pressed && styles.itemDetailsPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`View details for ${item.name}`}
                testID={`experience-list-item-details-${item.experienceId}`}
              >
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {[item.park, item.category].filter(Boolean).join(' • ')}
                </Text>

                {/* Visit badge (Requirement 13.3, task 13.2) — no badge when
                    never logged, visit-count-only when logged but unrated,
                    visit-count-plus-rating when at least one log is rated. */}
                {repeatCount > 0 ? (
                  <Text
                    style={styles.visitBadge}
                    testID={`experience-list-item-visit-badge-${item.experienceId}`}
                  >
                    {repeatCount} {repeatCount === 1 ? 'visit' : 'visits'}
                    {ratedCount > 0 ? ` · ★ ${averageRating!.toFixed(1)}` : ''}
                  </Text>
                ) : null}

                {/* Attribution label (Requirement 11.2) */}
                {showAttribution && item.addedByDisplayName ? (
                  <Text
                    style={styles.attributionLabel}
                    testID={`experience-list-attribution-${item.experienceId}`}
                  >
                    added by {item.addedByDisplayName}
                  </Text>
                ) : null}
              </Pressable>

              {/* "Log a visit" action (Requirement 13.5) — a sibling of
                  `itemDetails`/`itemDeleteBtn`, NOT nested inside the
                  details `Pressable`, to avoid nested-touchable conflicts.
                  Available to ANY viewer of the list, not gated on
                  `canEdit`/`myRole` — Visit_Summary is per-viewing-User data
                  (Requirement 13), so logging a personal visit to an item is
                  independent of list edit permissions, mirroring
                  `TripPlannedListScreen`'s "Log a completion" control being
                  available on every item regardless of done-state or role. */}
              <Pressable
                onPress={() => setLoggingExperienceId(item.experienceId)}
                style={styles.logVisitBtn}
                accessibilityRole="button"
                accessibilityLabel={`Log a visit to ${item.name}`}
                testID={`experience-list-item-log-visit-${item.experienceId}`}
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={theme.color.primary} />
              </Pressable>

              {/* Delete action (Requirement 9.7, 11.1) */}
              {canEdit ? (
                <Pressable
                  onPress={() => void handleDeleteItem(item.experienceId)}
                  style={styles.itemDeleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name} from list`}
                  testID={`experience-list-item-delete-${item.experienceId}`}
                >
                  <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                </Pressable>
              ) : null}
            </View>
          </Card>
        </View>
      );
    },
    [
      list?.myRole,
      openExperience,
      showAttribution,
      handleDeleteItem,
      visitSummaryByExperienceId,
      firstDoneIndex,
      doneItemCount,
    ],
  );

  // Loading state
  if (listQuery.isLoading) {
    return (
      <ScreenContainer style={styles.centerContainer}>
        <ActivityIndicator color={theme.color.primary} size="large" />
      </ScreenContainer>
    );
  }

  // Requirement 10.2: Unavailable state (list not found / no longer accessible)
  if (listQuery.isError || !list) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Experience List"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.unavailableWrap} testID="experience-list-unavailable-notice">
          <Ionicons name="alert-circle-outline" size={48} color={theme.color.danger} />
          <Text style={styles.unavailableTitle}>No longer available</Text>
          <Text style={styles.unavailableBody}>
            {transientNotice ?? 'This experience list does not exist or is no longer shared with you.'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="experience-list-unavailable-back-btn"
          >
            <Text style={styles.backBtnText}>Return to previous screen</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const canEdit = list.myRole === 'owner' || list.myRole === 'editor';
  const isOwner = list.myRole === 'owner';

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="experience-list-detail-screen">
        <GradientHeader
          title={list.name}
          subtitle={`by ${list.ownerDisplayName}`}
          compact
          onBack={() => navigation.goBack()}
        />

        <NestableScrollContainer contentContainerStyle={styles.content}>
          {/* Stale write message (Requirement 11.3) */}
          {staleWriteNotice ? (
            <View style={styles.staleNotice} testID="experience-list-stale-write-message">
              <Ionicons name="information-circle" size={18} color={theme.color.primary} />
              <Text style={styles.staleNoticeText}>{staleWriteNotice}</Text>
            </View>
          ) : null}

          {/* List Header Card */}
          <Card style={styles.headerCard}>
            <View style={styles.headerTop}>
              <View style={styles.titleArea}>
                <Text style={styles.listName} testID="experience-list-name">
                  {list.name}
                </Text>
                <Text style={styles.metaText}>
                  Created by {list.ownerDisplayName} •{' '}
                  {list.visibility === 'public' ? 'Public' : 'Private'}
                </Text>
              </View>

              <View style={styles.roleBadgeContainer}>
                <Badge
                  label={list.myRole === 'owner' ? 'Owner' : list.myRole === 'editor' ? 'Editor' : 'Viewer'}
                  color={list.myRole === 'editor' ? theme.color.primary : theme.color.textSecondary}
                />
              </View>
            </View>

            <View style={styles.actionRow}>
              {/* Like button */}
              <Pressable
                onPress={() => void handleToggleLike()}
                disabled={isLiking}
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel={`${list.liked ? 'Unlike' : 'Like'} list, ${list.likeCount} likes`}
                testID="experience-list-like-btn"
              >
                <Ionicons
                  name={list.liked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={list.liked ? theme.color.danger : theme.color.textSecondary}
                />
                <Text style={styles.actionButtonText}>{list.likeCount}</Text>
              </Pressable>

              {/* Save button (non-owners only; no unsave endpoint exists) */}
              {!isOwner ? (
                <Pressable
                  onPress={() => void handleSave()}
                  disabled={isSaving || list.saved}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={list.saved ? 'List saved' : 'Save list'}
                  testID="experience-list-save-btn"
                >
                  <Ionicons
                    name={list.saved ? 'bookmark' : 'bookmark-outline'}
                    size={20}
                    color={list.saved ? theme.color.primary : theme.color.textSecondary}
                  />
                  <Text style={styles.actionButtonText}>{list.saved ? 'Saved' : 'Save'}</Text>
                </Pressable>
              ) : null}

              {/* Manage sharing button (owner of private list only, Requirement 9.8). */}
              {isOwner && list.visibility === 'private' ? (
                <Pressable
                  onPress={() => setManageSharesVisible(true)}
                  style={styles.actionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Manage sharing"
                  testID="experience-list-manage-sharing-btn"
                >
                  <Ionicons name="people-outline" size={20} color={theme.color.primary} />
                  <Text style={styles.actionButtonText}>Share</Text>
                </Pressable>
              ) : null}

              {/* Pin button (owner only, Requirement 19.6) */}
              {isOwner ? (
                <Pressable
                  onPress={() => void handleTogglePinned()}
                  disabled={isTogglingPinned}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={list.pinnedAt !== null ? 'Unpin list' : 'Pin list'}
                  testID="experience-list-pin-btn"
                >
                  <Ionicons
                    name={list.pinnedAt !== null ? 'pin' : 'pin-outline'}
                    size={20}
                    color={list.pinnedAt !== null ? theme.color.primary : theme.color.textSecondary}
                  />
                  <Text
                    style={[
                      styles.actionButtonText,
                      list.pinnedAt !== null && styles.actionButtonTextPinned,
                    ]}
                  >
                    {list.pinnedAt !== null ? 'Pinned' : 'Pin'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Card>

          {/* Section Header — "Add items" entry point (Requirement 9.5, 11.1) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Items ({list.items.length})</Text>

            {canEdit ? (
              <Pressable
                onPress={() => setAddItemsModalVisible(true)}
                style={[styles.actionButton, styles.addItemsBtn]}
                accessibilityRole="button"
                accessibilityLabel="Add items to this list"
                testID="experience-list-add-items-btn"
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.addItemsBtnText}>Add items</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Items list — drag-reorder (owner/editor only) via
              react-native-draggable-flatlist's drag handle. */}
          {list.items.length === 0 ? (
            <View style={styles.emptyItemsWrap}>
              <Ionicons name="sparkles-outline" size={40} color={theme.color.textSecondary} />
              <Text style={styles.emptyItemsText}>No items in this list yet.</Text>
              {canEdit ? (
                <Pressable
                  onPress={() => setAddItemsModalVisible(true)}
                  style={styles.emptyAddBtn}
                >
                  <Text style={styles.emptyAddBtnText}>Add your first item</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <NestableDraggableFlatList
              data={[...list.items]}
              keyExtractor={(item) => item.experienceId}
              scrollEnabled={false}
              renderItem={renderDraggableItem}
              onDragEnd={handleDragEnd}
            />
          )}
        </NestableScrollContainer>

        {/* "Add items" entry point (Requirement 9.5) — a catalog search step
            scoped to non-Restaurant categories, with the target
            Experience_List (this screen's `experienceListId`) already
            determined, so there is no second list-selection step. */}
        <Modal
          visible={addItemsModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setAddItemsModalVisible(false)}
          testID="experience-list-add-items-modal"
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Items</Text>
                <Pressable
                  onPress={() => setAddItemsModalVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close add items"
                  testID="close-experience-list-add-items-btn"
                >
                  <Ionicons name="close" size={24} color={theme.color.textSecondary} />
                </Pressable>
              </View>
              {addItemsModalVisible ? (
                <AddItemsCatalogSearch
                  experienceListId={experienceListId}
                  existingExperienceIds={existingExperienceIds}
                  onAdded={handleItemAdded}
                />
              ) : null}
            </View>
          </View>
        </Modal>

        {/* Manage sharing sheet (Requirement 9.8, 11.4) */}
        <ManageExperienceListSharesSheet
          experienceListId={experienceListId}
          visible={manageSharesVisible}
          onClose={() => setManageSharesVisible(false)}
        />

        {/* "Log a visit" modal (Requirement 13.5, 13.6) — reuses the existing
            `LogVisitModal` exactly as-is (no new props, no new endpoint); it
            already defaults its own date field to today and submits
            `POST /me/experiences/:id/logs` internally. Conditionally
            rendered per `loggingExperienceId`, mirroring
            `LiveWaitsScreen.tsx`'s `activeLogExperienceId` pattern — this
            naturally mounts a fresh instance (and fresh internal
            rating/note/date state) each time a different row's action is
            tapped, rather than reusing one stale instance across rows. On
            success, invalidates the EXACT query key `visitSummaryQuery`
            uses above, so the item's done-state and rating badge refetch
            and update without leaving this screen (Requirement 13.6). */}
        {loggingExperienceId !== null ? (
          <LogVisitModal
            experienceId={loggingExperienceId}
            visible={Boolean(loggingExperienceId)}
            onClose={() => setLoggingExperienceId(null)}
            onLogged={() => {
              setLoggingExperienceId(null);
              void queryClient.invalidateQueries({
                queryKey: ['experience-list-visit-summary', experienceListId, list?.version] as const,
              });
            }}
          />
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: theme.spacing.md,
    gap: 12,
  },
  unavailableWrap: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 40,
  },
  unavailableTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  unavailableBody: {
    fontSize: 15,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 12,
    backgroundColor: theme.color.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  staleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(107, 70, 193, 0.1)',
    padding: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.primary,
  },
  staleNoticeText: {
    fontSize: 13,
    color: theme.color.primary,
    fontWeight: '500',
    flex: 1,
  },
  headerCard: {
    padding: theme.spacing.md,
    gap: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleArea: {
    flex: 1,
    marginRight: 8,
  },
  listName: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  metaText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 4,
  },
  roleBadgeContainer: {
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  actionButtonTextPinned: {
    color: theme.color.primary,
  },
  addItemsBtn: {
    backgroundColor: theme.color.primary,
  },
  addItemsBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  emptyItemsWrap: {
    padding: 36,
    alignItems: 'center',
    gap: 8,
  },
  emptyItemsText: {
    fontSize: 15,
    color: theme.color.textSecondary,
  },
  emptyAddBtn: {
    marginTop: 8,
    backgroundColor: theme.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
  },
  emptyAddBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  // Task 13.3: mirrors `TripPlannedListScreen`'s `doneSection`/`doneHeading`
  // visual pattern (own testID/style names — not the same instance).
  doneSection: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  doneHeading: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
  },
  itemCard: {
    padding: 12,
    // `NestableDraggableFlatList` renders each row inside its own internal
    // list, as ONE opaque child of `content` — the parent's `gap: 12`
    // no longer reaches inside it. Space rows here instead.
    marginBottom: 12,
  },
  itemCardDragging: {
    opacity: 0.85,
    ...theme.shadow.card,
  },
  itemCardMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemDetails: {
    flex: 1,
  },
  itemDetailsPressed: {
    opacity: 0.7,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  itemMeta: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  visitBadge: {
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
    marginTop: 4,
  },
  attributionLabel: {
    fontSize: 11,
    color: theme.color.primary,
    fontWeight: '500',
    marginTop: 4,
  },
  dragHandle: {
    padding: 6,
    marginRight: 4,
  },
  itemDeleteBtn: {
    padding: 6,
  },
  logVisitBtn: {
    padding: 6,
    marginRight: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  addItemsSearchWrap: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  addItemsSearchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  addItemsSearchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  clearSearchBtn: {
    padding: 4,
  },
  addItemsHintText: {
    color: theme.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    padding: 16,
  },
  addItemsErrorText: {
    color: theme.color.danger,
    fontSize: 13,
    marginBottom: 8,
  },
  addItemsLoading: {
    padding: 16,
  },
  addItemsResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  addItemsResultRowPressed: {
    backgroundColor: theme.color.surfaceAlt,
  },
  addItemsResultRowDisabled: {
    opacity: 0.5,
  },
  addItemsResultText: {
    flex: 1,
  },
  addItemsResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  addItemsResultBadges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  addItemsAddedTag: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
});
