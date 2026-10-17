import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  ExperienceDTO,
  FoodItemDTO,
  FoodListDetailDTO,
  FoodListItemDTO,
  LocationSuggestionDTO,
  UserSubmittedLocationDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { withAlpha } from '../../theme/theme';
import { Badge, Card, GradientHeader, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { FOOD_LIST_DETAIL } from './FoodListDetailScreen.palette';
import CreateLocationModal from '../catalog/CreateLocationModal';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import ManageFoodListSharesSheet from './ManageFoodListSharesSheet';
import MarkGottenUndoToast from './MarkGottenUndoToast';
import RateOnCheckoffPrompt from './RateOnCheckoffPrompt';
import { useFoodListNotice } from './foodListNotice';
import { useOpenExperience } from '../navigation/experienceNavigation';
import { useKeyboardBottomInset } from '../../hooks/useKeyboardBottomInset';

export interface FoodListDetailParams {
  readonly foodListId: string;
}

interface CatalogSearchResponse {
  readonly experiences: readonly ExperienceDTO[];
}

type FoodListDetailRouteProp = RouteProp<{ FoodListDetail: FoodListDetailParams }, 'FoodListDetail'>;

/** The checklist item currently awaiting a rating decision (Requirement 13.15). */
interface RatingPromptTarget {
  readonly foodItemId: string;
  readonly name: string;
}

/** The completed checklist item awaiting rating update after the fact (Requirement 13.23). */
interface EditRatingTarget {
  readonly foodItemId: string;
  readonly logId: string | null;
  readonly name: string;
  readonly initialRating: number | null;
}

/** A search result item in the restaurant/place search modal (official restaurant or community spot). */
type SearchPlaceItem =
  | { readonly kind: 'restaurant'; readonly data: ExperienceDTO }
  | { readonly kind: 'custom_location'; readonly data: LocationSuggestionDTO };

/**
 * A single active undo affordance for one mark-gotten submission
 * (Requirement 13.16-13.18). Keyed to the specific `logId` that submission
 * created — never "the most recent log for this Food_Item" — so undo can
 * never revert an unrelated, pre-existing log for the same dish
 * (Requirement 13.17). `toastKey` is a local render key distinct from
 * `logId` only in spirit (they're the same value today, but kept as
 * separate fields so a future change to the toast's identity scheme
 * doesn't have to also mean changing what undo targets).
 */
interface ActiveUndoToast {
  readonly toastKey: string;
  readonly logId: string;
  readonly foodItemId: string;
  readonly itemName: string;
}

function deviceTimeZone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC';
}

function ymdInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }
  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

export default function FoodListDetailScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const route = useRoute<FoodListDetailRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const openExperience = useOpenExperience();
  const { foodListId } = route.params;
  const queryClient = useQueryClient();

  const [isLiking, setIsLiking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingChecklist, setIsTogglingChecklist] = useState(false);
  const [isTogglingPinned, setIsTogglingPinned] = useState(false);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [staleWriteNotice, setStaleWriteNotice] = useState<string | null>(null);
  const [manageSharesVisible, setManageSharesVisible] = useState(false);
  const [markingGottenId, setMarkingGottenId] = useState<string | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  // Requirement 13.15: the item awaiting the optional rating prompt.
  const [ratingPromptItem, setRatingPromptItem] = useState<RatingPromptTarget | null>(null);
  // Requirement 13.23: the completed item awaiting a rating edit after the fact.
  const [editRatingItem, setEditRatingItem] = useState<EditRatingTarget | null>(null);
  // Requirement 13.16-13.18: one entry per currently-visible undo toast;
  // multiple can coexist (Requirement 13.18), each acting only on its own
  // `logId` (Requirement 13.17).
  const [activeUndoToasts, setActiveUndoToasts] = useState<readonly ActiveUndoToast[]>([]);

  // Entry Point 2: Restaurant search modal & scoped picker
  const [restaurantSearchModalVisible, setRestaurantSearchModalVisible] = useState(false);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [debouncedRestaurantSearch, setDebouncedRestaurantSearch] = useState('');
  const [selectedExperience, setSelectedExperience] = useState<ExperienceDTO | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<UserSubmittedLocationDTO | null>(null);
  const [createLocationModalVisible, setCreateLocationModalVisible] = useState(false);
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [isAddingItems, setIsAddingItems] = useState(false);

  const {
    keyboardInset: restaurantSearchKeyboardInset,
    getAvailableModalHeight: getRestaurantSearchModalHeight,
  } = useKeyboardBottomInset(restaurantSearchModalVisible);

  useEffect(() => {
    if (restaurantSearch === debouncedRestaurantSearch) return;
    const timer = setTimeout(() => {
      setDebouncedRestaurantSearch(restaurantSearch);
    }, 250);
    return () => clearTimeout(timer);
  }, [restaurantSearch, debouncedRestaurantSearch]);

  // Reset search query whenever the restaurant search modal closes
  useEffect(() => {
    if (!restaurantSearchModalVisible) {
      setRestaurantSearch('');
      setDebouncedRestaurantSearch('');
    }
  }, [restaurantSearchModalVisible]);

  useEffect(() => {
    return () => {
      Keyboard.dismiss();
    };
  }, []);

  const handleCloseRestaurantSearch = useCallback(() => {
    Keyboard.dismiss();
    setRestaurantSearchModalVisible(false);
    setRestaurantSearch('');
    setDebouncedRestaurantSearch('');
  }, []);

  const handleOpenCreateLocation = useCallback(() => {
    Keyboard.dismiss();
    setRestaurantSearchModalVisible(false);
    setRestaurantSearch('');
    setDebouncedRestaurantSearch('');
    setCreateLocationModalVisible(true);
  }, []);

  const handleLocationSelected = useCallback((location: UserSubmittedLocationDTO) => {
    setSelectedLocation(location);
    setSelectedExperience(null);
    setCreateLocationModalVisible(false);
    setPickerModalVisible(true);
  }, []);

  const transientNotice = useFoodListNotice();

  const listQuery = useQuery<FoodListDetailDTO, ApiError>({
    queryKey: ['food-list-detail', foodListId],
    queryFn: () =>
      apiRequest<FoodListDetailDTO>(
        'GET',
        `/food-lists/${encodeURIComponent(foodListId)}`,
      ),
  });

  // Restaurant search for Entry Point 2
  //
  // `GET /catalog` validates its query params with a `.strict()` Zod schema
  // that only recognizes `parkId`, `category`/`categories`, `areaType`, `q`,
  // `land`, and `worldShowcaseCountry` (apps/api/src/services/catalog/routes.ts).
  // `search` and `limit` are NOT recognized keys, so sending them caused every
  // request here to be rejected with `400 validation_failed` — silently, since
  // this query only branches on `isLoading` and falls through to an empty
  // `experiences` array on error, rendering "No restaurants found" instead of
  // surfacing the failure. Use `category` + `q`, mirroring the already-correct
  // usage in `ExperiencePicker.tsx`.
  const restaurantSearchQuery = useQuery<CatalogSearchResponse, ApiError>({
    queryKey: ['restaurant-catalog-search', debouncedRestaurantSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        category: 'Restaurant',
      });
      if (debouncedRestaurantSearch.trim()) {
        params.set('q', debouncedRestaurantSearch.trim());
      }
      return apiRequest<CatalogSearchResponse>('GET', `/catalog?${params.toString()}`);
    },
    enabled: restaurantSearchModalVisible,
  });

  // Community snack carts/stands search for Entry Point 2 (Requirement 9.5c)
  const customLocationSearchQuery = useQuery<readonly LocationSuggestionDTO[], ApiError>({
    queryKey: ['custom-location-search', debouncedRestaurantSearch],
    queryFn: async () => {
      const q = debouncedRestaurantSearch.trim();
      if (!q) return [];
      const res = await apiRequest<
        | { readonly suggestions: readonly LocationSuggestionDTO[] }
        | readonly LocationSuggestionDTO[]
      >('GET', `/locations/suggest?q=${encodeURIComponent(q)}`);
      return Array.isArray(res)
        ? res
        : ('suggestions' in res
          ? (res.suggestions ?? [])
          : []);
    },
    enabled: restaurantSearchModalVisible && debouncedRestaurantSearch.trim().length > 0,
  });

  // Unified search results: catalog restaurants + community snack spots
  const searchResults = useMemo<readonly SearchPlaceItem[]>(() => {
    const restaurants: readonly SearchPlaceItem[] = (
      restaurantSearchQuery.data?.experiences ?? []
    ).map((exp) => ({
      kind: 'restaurant',
      data: exp,
    }));

    if (!debouncedRestaurantSearch.trim()) {
      return restaurants;
    }

    const customLocations: readonly SearchPlaceItem[] = (
      customLocationSearchQuery.data ?? []
    ).map((loc) => ({
      kind: 'custom_location',
      data: loc,
    }));

    return [...restaurants, ...customLocations];
  }, [
    debouncedRestaurantSearch,
    restaurantSearchQuery.data?.experiences,
    customLocationSearchQuery.data,
  ]);

  const list = listQuery.data;

  // Background refetch rate limit notice: if list is already loaded in cache
  // and a background refresh encounters 429, inform the user without unmounting.
  useEffect(() => {
    if (list && listQuery.isError) {
      if (
        listQuery.error instanceof ApiError &&
        (listQuery.error.code === 'rate_limit_exceeded' || listQuery.error.status === 429)
      ) {
        setStaleWriteNotice('Rate limit reached. Please wait a moment before refreshing.');
      }
    }
  }, [list, listQuery.isError, listQuery.error]);

  // Requirement 11.2: attribution label shown ONLY when list has 2+ distinct contributors
  const showAttribution = useMemo(() => {
    if (!list || !list.items) return false;
    const contributorIds = new Set(
      list.items.map((i) => i.addedByUserId).filter((id): id is string => Boolean(id)),
    );
    return contributorIds.size >= 2;
  }, [list]);

  // Actions
  async function handleToggleLike(): Promise<void> {
    if (!list || isLiking) return;
    setIsLiking(true);
    try {
      if (list.liked) {
        await apiRequest('DELETE', `/food-lists/${encodeURIComponent(foodListId)}/like`);
      } else {
        await apiRequest('POST', `/food-lists/${encodeURIComponent(foodListId)}/like`);
      }
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsLiking(false);
    }
  }

  // Requirement 13.2: owner can toggle a list into/out of checklist mode
  // at any time after creation, mirroring how `visibility` is changed via
  // the same `PATCH /me/food-lists/:id` endpoint.
  async function handleToggleChecklistMode(): Promise<void> {
    if (!list || isTogglingChecklist || list.myRole !== 'owner') return;
    setIsTogglingChecklist(true);
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(foodListId)}`, {
        isChecklist: !list.isChecklist,
      });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
    } catch {
      // Ignore
    } finally {
      setIsTogglingChecklist(false);
    }
  }

  // Requirement 14.6: owner can toggle list pin state from the detail screen
  async function handleTogglePinned(): Promise<void> {
    if (!list || isTogglingPinned || list.myRole !== 'owner') return;
    setIsTogglingPinned(true);
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(foodListId)}`, {
        pinned: list.pinnedAt === null,
      });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'food_list_pin_limit_reached') {
        Alert.alert(
          'Pin Limit Reached',
          'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
        );
      }
    } finally {
      setIsTogglingPinned(false);
    }
  }

  // Requirement 3.5, Property 26: owner can toggle list visibility directly inside the list
  async function handleToggleVisibility(): Promise<void> {
    if (!list || isTogglingVisibility || list.myRole !== 'owner') return;
    setIsTogglingVisibility(true);
    const nextVisibility = list.visibility === 'public' ? 'private' : 'public';
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(foodListId)}`, {
        visibility: nextVisibility,
      });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['discover-food-lists'] });
    } catch {
      // Ignore
    } finally {
      setIsTogglingVisibility(false);
    }
  }

  // Requirement 3.5, Property 26: owner can rename list from options menu
  async function handleRenameList(): Promise<void> {
    if (!list || !renameValue.trim() || isRenaming || list.myRole !== 'owner') return;
    Keyboard.dismiss();
    setIsRenaming(true);
    const trimmed = renameValue.trim();
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(foodListId)}`, {
        name: trimmed,
      });
      setRenameModalVisible(false);
      setRenameValue('');
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['discover-food-lists'] });
    } catch {
      // Ignore
    } finally {
      setIsRenaming(false);
    }
  }

  // Requirement 3.5, Property 26: owner can delete list from options menu
  function promptDeleteList(): void {
    if (!list || list.myRole !== 'owner') return;
    setOptionsMenuVisible(false);
    Alert.alert(
      'Delete List',
      `Are you sure you want to delete "${list.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void executeDeleteList(),
        },
      ],
    );
  }

  async function executeDeleteList(): Promise<void> {
    if (!list || isDeleting || list.myRole !== 'owner') return;
    setIsDeleting(true);
    try {
      await apiRequest('DELETE', `/me/food-lists/${encodeURIComponent(foodListId)}`);
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['discover-food-lists'] });
      navigation.goBack();
    } catch {
      setIsDeleting(false);
    }
  }


  async function handleSave(): Promise<void> {
    if (!list || isSaving || list.myRole === 'owner') return;
    setIsSaving(true);
    try {
      await apiRequest('POST', `/food-lists/${encodeURIComponent(foodListId)}/save`);
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteItem(foodItemId: string): Promise<void> {
    try {
      await apiRequest(
        'DELETE',
        `/me/food-lists/${encodeURIComponent(foodListId)}/items/${encodeURIComponent(foodItemId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
    } catch {
      // Ignore
    }
  }

  // Task 8.15: Submit expectedVersion on reorder; handle food_list_stale_write (Requirement 11.3)
  async function handleReorderItems(newItems: readonly FoodListItemDTO[]): Promise<void> {
    if (!list) return;
    setStaleWriteNotice(null);

    const foodItemIds = newItems.map((i) => i.foodItemId);
    try {
      await apiRequest(
        'PUT',
        `/me/food-lists/${encodeURIComponent(foodListId)}/items/order`,
        {
          foodItemIds,
          expectedVersion: list.version,
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'food_list_stale_write') {
        // Refetch and display brief message
        await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
        setStaleWriteNotice('List was updated by another collaborator. Refreshed.');
      }
    }
  }

  // Requirement 11's original up/down tap controls were unclear affordances
  // — they looked like expand/collapse chevrons, not a reorder action. A
  // drag handle (react-native-draggable-flatlist) replaces them: dragging a
  // row directly to its new position is the unambiguous, standard mobile
  // pattern for reordering, unlike a pair of small stacked arrows.
  function handleDragEnd({ data }: { data: readonly FoodListItemDTO[] }): void {
    void handleReorderItems(data);
  }

  // Task 17.3 / 19.5: Mark an item gotten via POST /me/food-items/:foodItemId/logs
  // (Requirement 13.6, 13.11), optionally including a rating (Requirement
  // 13.15). Captures the created log's `id` from the response to back a
  // per-submission undo toast (Requirement 13.16, 13.17) — the endpoint
  // already returns `FoodItemLogDTO.id`, so no backend change is needed.
  // Task 17.4: Client-local completion celebration on transition to 100% (Requirement 13.12)
  async function handleMarkGotten(
    foodItemId: string,
    itemName: string,
    rating?: number,
  ): Promise<void> {
    if (!list || markingGottenId) return;
    setMarkingGottenId(foodItemId);
    const tz = deviceTimeZone();
    const today = ymdInTimeZone(new Date(), tz);
    const preGottenCount = list.gottenCount ?? 0;
    const preItemCount = list.itemCount;

    setStaleWriteNotice(null);

    try {
      const created = await apiRequest<{ readonly id: string }>(
        'POST',
        `/me/food-items/${encodeURIComponent(foodItemId)}/logs`,
        {
          visitedOn: today,
          userTz: tz,
          ...(rating !== undefined ? { rating } : {}),
        },
      );
      const updatedDetail = await queryClient.fetchQuery<FoodListDetailDTO>({
        queryKey: ['food-list-detail', foodListId],
        queryFn: () =>
          apiRequest<FoodListDetailDTO>(
            'GET',
            `/food-lists/${encodeURIComponent(foodListId)}`,
          ),
      });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });

      // Requirement 13.16/13.18: append this submission's own undo toast
      // rather than replacing any existing one — several can be visible
      // at once, each scoped to the specific log it was created for.
      setActiveUndoToasts((prev) => [
        ...prev,
        {
          toastKey: `${created.id}-${Date.now()}`,
          logId: created.id,
          foodItemId,
          itemName,
        },
      ]);

      const postGottenCount = updatedDetail.gottenCount ?? 0;
      const postItemCount = updatedDetail.itemCount;
      if (
        preGottenCount < preItemCount &&
        postGottenCount === postItemCount &&
        postItemCount > 0
      ) {
        setShowCelebration(true);
      }
    } catch {
      // Surface the failure rather than letting the checkbox silently do
      // nothing — an empty catch here previously hid a real bug (a missing
      // required `userTz` field made every mark-gotten request reject with
      // 400 validation_failed with no visible sign to the User).
      setStaleWriteNotice("Couldn't save that. Please try again.");
    } finally {
      setMarkingGottenId(null);
    }
  }

  // Requirement 13.16, 13.17: revert only the specific log a given toast
  // was created for — never "the most recent log for this Food_Item" —
  // then remove that toast. A pre-existing, unrelated log for the same
  // dish (Requirement 13.7's repeat-log allowance) is never touched.
  async function handleUndoMarkGotten(toast: ActiveUndoToast): Promise<void> {
    try {
      await apiRequest(
        'DELETE',
        `/me/food-items/${encodeURIComponent(toast.foodItemId)}/logs/${encodeURIComponent(toast.logId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Ignore — the toast still dismisses; a failed undo leaves the log
      // in place, which the User can still correct via My Food History.
    }
  }

  function dismissUndoToast(toastKey: string): void {
    setActiveUndoToasts((prev) => prev.filter((t) => t.toastKey !== toastKey));
  }

  // Requirement 13.23: Update rating after the fact on a completed checklist item
  async function handleUpdateRating(
    foodItemId: string,
    logId: string,
    rating: number,
  ): Promise<void> {
    try {
      await apiRequest(
        'PATCH',
        `/me/food-items/${encodeURIComponent(foodItemId)}/logs/${encodeURIComponent(logId)}`,
        { rating },
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['me-food-item-logs'] });
    } catch {
      // Ignore
    }
  }

  // Entry point 2: Add selected items from picker scoped to restaurant
  async function handleConfirmAddItems(pickedItems: readonly FoodItemDTO[]): Promise<void> {
    if (pickedItems.length === 0 || isAddingItems) return;
    setIsAddingItems(true);
    let hadError = false;
    let rateLimited = false;
    try {
      const existingIds = new Set(list?.items.map((i) => i.foodItemId) ?? []);
      for (const item of pickedItems) {
        if (existingIds.has(item.id)) {
          continue;
        }
        try {
          await apiRequest(
            'POST',
            `/me/food-lists/${encodeURIComponent(foodListId)}/items`,
            {
              foodItemId: item.id,
            },
          );
          existingIds.add(item.id);
        } catch (err) {
          // Swallow duplicate per Requirement 9.4
          if (err instanceof ApiError && err.code === 'food_list_item_duplicate') {
            continue;
          }
          if (err instanceof ApiError && (err.code === 'rate_limit_exceeded' || err.status === 429)) {
            rateLimited = true;
          }
          hadError = true;
        }
      }
      setPickerModalVisible(false);
      setSelectedExperience(null);
      setSelectedLocation(null);
      if (rateLimited) {
        setStaleWriteNotice('Too many requests. Please wait a moment before adding more items.');
      } else if (hadError) {
        setStaleWriteNotice("Couldn't add some items to the list. Please try again.");
      }
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      // Adding items changes this list's itemCount, which the collection
      // card on MyFoodListsScreen also displays — invalidate it too so that
      // screen doesn't keep showing a stale count after navigating back,
      // mirroring the equivalent invalidation already done at the end of
      // AddToListsSheet.tsx's own add/remove flow (Entry Point 1).
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'rate_limit_exceeded' || err.status === 429)) {
        setStaleWriteNotice('Too many requests. Please wait a moment before adding more items.');
      } else {
        setStaleWriteNotice("Couldn't add items to the list. Please try again.");
      }
    } finally {
      setIsAddingItems(false);
    }
  }

  // Stable `renderItem` identity — an inline arrow literal passed to
  // `NestableDraggableFlatList` is recreated every render, which
  // `VirtualizedList` (the engine underlying both `FlatList` and
  // `NestableDraggableFlatList`) treats as a changed render function and
  // forces the whole visible window to re-render/re-measure, producing the
  // "large list that is slow to update" warning even though the row markup
  // below is otherwise unchanged. See `DestinationScreen.tsx`'s `renderRow`
  // for the same fix.
  const renderDraggableItem = useCallback(
    (params: RenderItemParams<FoodListItemDTO>) => {
      const { item, drag, isActive } = params;
      const placeName = item.experienceName ?? item.locationName ?? 'Walt Disney World';
      // `canEdit`/`isChecklist` are normally derived below (after the
      // loading/unavailable early returns narrow `list` to non-null), but
      // this callback must be declared before those early returns to
      // satisfy the Rules of Hooks — so it re-derives the same booleans
      // from the raw, possibly-undefined `list` query data instead of
      // referencing the later `const canEdit`/`isOwner` declarations.
      const canEdit = list?.myRole === 'owner' || list?.myRole === 'editor';
      const isChecklist = list?.isChecklist ?? false;
      return (
        <Card
          style={[styles.itemCard, isActive && styles.itemCardDragging]}
          testID={`food-list-item-row-${item.foodItemId}`}
        >
          <View style={styles.itemCardMain}>
            {/* Drag handle — leading edge, grouped with the
                checklist completion indicator (both are "state of
                this row" controls), leaving delete as the sole
                trailing action. Press-and-hold to pick up the row,
                drag to its new position; replaces the original
                up/down chevron pair. */}
            {canEdit ? (
              <Pressable
                onLongPress={drag}
                disabled={isActive}
                style={styles.dragHandle}
                accessibilityRole="button"
                accessibilityLabel={`Drag to reorder ${item.name}`}
                testID={`food-list-item-drag-handle-${item.foodItemId}`}
              >
                <Ionicons
                  name="reorder-three"
                  size={22}
                  color={t.color.textSecondary}
                />
              </Pressable>
            ) : null}

            {/* Item details (name, location, price): tapping navigates to the
                restaurant's ExperienceDetailScreen when experienceId is present
                (Requirement 13.20 amended). When experienceId is null (e.g. snack cart),
                the row is inert. It never triggers mark-gotten — that action is
                exclusively owned by the trailing "Check off" button below. */}
            <Pressable
              onPress={
                item.experienceId
                  ? () => openExperience(item.experienceId!)
                  : undefined
              }
              disabled={!item.experienceId}
              style={({ pressed }) => [
                styles.itemDetails,
                pressed && item.experienceId && styles.itemDetailsPressed,
              ]}
              accessibilityRole={item.experienceId ? 'button' : undefined}
              accessibilityLabel={
                item.experienceId
                  ? `View details for ${placeName}`
                  : undefined
              }
              testID={`food-list-item-details-${item.foodItemId}`}
            >
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemLocation}>{placeName}</Text>
              {item.price ? (
                <Text style={styles.itemPrice}>{item.price}</Text>
              ) : null}

              {/* Attribution label (Requirement 11.2) */}
              {showAttribution && item.addedByDisplayName ? (
                <Text
                  style={styles.attributionLabel}
                  testID={`food-list-attribution-${item.foodItemId}`}
                >
                  added by {item.addedByDisplayName}
                </Text>
              ) : null}
            </Pressable>

            {/* Trailing completion affordance / badge (Requirement 13.14, 13.19, 13.20):
                when not yet gotten, renders an outline "Check off" button so users can
                readily tell the item is completable. Tapping it opens the rating prompt.
                Once gotten, transforms into the completed status badge showing rating/10
                or generic "Ate this". Never rendered as a tap target once gotten —
                undo is only ever available through the action-scoped toast
                (Requirement 13.16-13.18), never from this badge. */}
            {isChecklist && !item.gotten ? (
              <Pressable
                onPress={() =>
                  setRatingPromptItem({
                    foodItemId: item.foodItemId,
                    name: item.name,
                  })
                }
                disabled={markingGottenId === item.foodItemId}
                style={({ pressed }) => [
                  styles.checkOffBtn,
                  pressed && styles.checkOffBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Check off: ${item.name}`}
                testID={`food-list-item-check-off-btn-${item.foodItemId}`}
              >
                <Text style={styles.checkOffBtnText}>Check off</Text>
              </Pressable>
            ) : null}

            {isChecklist && item.gotten ? (
              <Pressable
                onPress={() =>
                  setEditRatingItem({
                    foodItemId: item.foodItemId,
                    logId: item.logId ?? null,
                    name: item.name,
                    initialRating: item.rating ?? null,
                  })
                }
                style={({ pressed }) => [
                  styles.gottenBadge,
                  pressed && styles.gottenBadgePressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Rating for ${item.name}: ${item.rating != null ? `${item.rating} out of 10` : 'unrated'}. Tap to edit rating`}
                testID={`food-list-item-gotten-badge-${item.foodItemId}`}
              >
                <Ionicons name="checkmark" size={14} color={t.color.primaryFg} />
                <Text style={styles.gottenBadgeText}>
                  {item.rating != null ? `${item.rating}/10` : 'Ate this'}
                </Text>
              </Pressable>
            ) : null}

            {/* Delete action (Requirement 11.1) — the sole trailing
                action now that the drag handle moved to the
                leading edge. */}
            {canEdit ? (
              <Pressable
                onPress={() => void handleDeleteItem(item.foodItemId)}
                style={styles.itemDeleteBtn}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name} from list`}
                testID={`food-list-item-delete-${item.foodItemId}`}
              >
                <Ionicons name="trash-outline" size={18} color={t.color.danger} />
              </Pressable>
            ) : null}
          </View>
        </Card>
      );
    },
    [
      list?.myRole,
      openExperience,
      showAttribution,
      list?.isChecklist,
      markingGottenId,
      handleDeleteItem,
      styles,
      t,
    ],
  );

  // Stable `renderItem` identity for the restaurant / community location search results list
  const renderSearchResult = useCallback(
    ({ item }: { item: SearchPlaceItem }) => {
      if (item.kind === 'restaurant') {
        const exp = item.data;
        return (
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setSelectedExperience(exp);
              setSelectedLocation(null);
              setRestaurantSearchModalVisible(false);
              setRestaurantSearch('');
              setDebouncedRestaurantSearch('');
              setPickerModalVisible(true);
            }}
            style={({ pressed }) => [styles.restaurantRow, pressed && styles.restaurantRowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Select restaurant ${exp.name}`}
            testID={`restaurant-select-row-${exp.id}`}
          >
            <Ionicons name="restaurant" size={20} color={t.color.primaryFg} />
            <View style={styles.restaurantRowText}>
              <Text style={styles.restaurantRowName}>{exp.name}</Text>
              <Text style={styles.restaurantRowMeta}>{exp.park}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textSecondary} />
          </Pressable>
        );
      } else {
        const loc = item.data;
        return (
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setSelectedLocation({
                id: loc.id,
                name: loc.name,
                park: loc.park,
              });
              setSelectedExperience(null);
              setRestaurantSearchModalVisible(false);
              setRestaurantSearch('');
              setDebouncedRestaurantSearch('');
              setPickerModalVisible(true);
            }}
            style={({ pressed }) => [styles.restaurantRow, pressed && styles.restaurantRowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Select snack cart ${loc.name}`}
            testID={`custom-location-select-row-${loc.id}`}
          >
            <Ionicons name="fast-food-outline" size={20} color={t.color.primaryFg} />
            <View style={styles.restaurantRowText}>
              <View style={styles.locationTitleRow}>
                <Text style={styles.restaurantRowName}>{loc.name}</Text>
                <Badge label="Snack Cart" />
              </View>
              <Text style={styles.restaurantRowMeta}>{loc.park}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textSecondary} />
          </Pressable>
        );
      }
    },
    [styles, t],
  );

  // Loading state (only show full-screen loader on initial fetch when no cached list exists)
  if (listQuery.isLoading && !list) {
    return (
      <ScreenContainer style={styles.centerContainer}>
        <ActivityIndicator color={t.color.primaryFg} size="large" />
      </ScreenContainer>
    );
  }

  // Requirement 10.2 / Task 8.13: Unavailable state
  // Check if list was explicitly deleted or revoked (404/403 food_list_not_found)
  const isDeletedOrRevoked =
    listQuery.error instanceof ApiError &&
    (listQuery.error.code === 'food_list_not_found' ||
      listQuery.error.status === 404 ||
      listQuery.error.status === 403);

  if (isDeletedOrRevoked) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Food List"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.unavailableWrap} testID="food-list-unavailable-notice">
          <Ionicons name="alert-circle-outline" size={48} color={t.color.danger} />
          <Text style={styles.unavailableTitle}>No longer available</Text>
          <Text style={styles.unavailableBody}>
            {transientNotice ?? 'This food list does not exist or is no longer shared with you.'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="food-list-unavailable-back-btn"
          >
            <Text style={styles.backBtnText}>Return to previous screen</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  // If initial load failed with no cached list
  if (!list && listQuery.isError) {
    const isRateLimited =
      listQuery.error instanceof ApiError &&
      (listQuery.error.code === 'rate_limit_exceeded' || listQuery.error.status === 429);

    if (isRateLimited) {
      return (
        <ScreenContainer>
          <GradientHeader
            title="Food List"
            compact
            onBack={() => navigation.goBack()}
          />
          <View style={styles.unavailableWrap} testID="food-list-rate-limit-notice">
            <Ionicons name="time-outline" size={48} color={t.color.warning} />
            <Text style={styles.unavailableTitle}>Too many requests</Text>
            <Text style={styles.unavailableBody}>
              Please wait a moment and try again.
            </Text>
            <Pressable
              onPress={() => void listQuery.refetch()}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry loading food list"
              testID="food-list-rate-limit-retry-btn"
            >
              <Text style={styles.backBtnText}>Retry</Text>
            </Pressable>
          </View>
        </ScreenContainer>
      );
    }

    // Default error screen for initial load failure when list is not found or failed (Task 8.13)
    return (
      <ScreenContainer>
        <GradientHeader
          title="Food List"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.unavailableWrap} testID="food-list-unavailable-notice">
          <Ionicons name="alert-circle-outline" size={48} color={t.color.danger} />
          <Text style={styles.unavailableTitle}>No longer available</Text>
          <Text style={styles.unavailableBody}>
            {transientNotice ?? 'This food list does not exist or is no longer shared with you.'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="food-list-unavailable-back-btn"
          >
            <Text style={styles.backBtnText}>Return to previous screen</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  if (!list) {
    return (
      <ScreenContainer style={styles.centerContainer}>
        <ActivityIndicator color={t.color.primaryFg} size="large" />
      </ScreenContainer>
    );
  }

  const canEdit = list.myRole === 'owner' || list.myRole === 'editor';
  const isOwner = list.myRole === 'owner';

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="food-list-detail-screen">
        <GradientHeader
        title={list.name}
        subtitle={`by ${list.ownerDisplayName}`}
        compact
        onBack={() => navigation.goBack()}
      />

      <NestableScrollContainer
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Completion celebration banner (Requirement 13.12) */}
        {showCelebration ? (
          <View style={styles.celebrationCard} testID="food-list-completion-celebration">
            <View style={styles.celebrationTop}>
              <View style={styles.celebrationIconRow}>
                <Ionicons name="sparkles" size={24} color={t.color.starRating} />
                <Text style={styles.celebrationTitle}>List Complete!</Text>
              </View>
              <Pressable
                onPress={() => setShowCelebration(false)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss celebration"
                style={styles.celebrationDismissBtn}
                testID="dismiss-celebration-btn"
              >
                <Ionicons name="close" size={20} color={t.color.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.celebrationMessage}>
              You&apos;ve tried everything on {list.name}!
            </Text>
          </View>
        ) : null}

        {/* Stale write message (Requirement 11.3) */}
        {staleWriteNotice ? (
          <View style={styles.staleNotice} testID="food-list-stale-write-message">
            <Ionicons name="information-circle" size={18} color={t.color.primaryFg} />
            <Text style={styles.staleNoticeText}>{staleWriteNotice}</Text>
          </View>
        ) : null}

        {/* List Header Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.titleArea}>
              <Text style={styles.listName} testID="food-list-name">{list.name}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>Created by {list.ownerDisplayName} • </Text>
                {isOwner ? (
                  <Pressable
                    onPress={() => void handleToggleVisibility()}
                    disabled={isTogglingVisibility}
                    style={({ pressed }) => [
                      styles.visibilityBadge,
                      pressed && styles.visibilityBadgePressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`List is ${list.visibility}. Tap to make ${list.visibility === 'public' ? 'private' : 'public'}`}
                    testID="food-list-visibility-toggle-badge"
                  >
                    <Ionicons
                      name={list.visibility === 'public' ? 'globe-outline' : 'lock-closed-outline'}
                      size={12}
                      color={t.color.primaryFg}
                    />
                    <Text style={styles.visibilityBadgeText}>
                      {list.visibility === 'public' ? 'Public' : 'Private'}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.metaText}>
                    {list.visibility === 'public' ? 'Public' : 'Private'}
                  </Text>
                )}
              </View>
            </View>

            {/* Badges & Options Menu */}
            <View style={styles.headerTopRight}>
              <View style={styles.roleBadgeContainer}>
                <Badge
                  label={list.myRole === 'owner' ? 'Owner' : list.myRole === 'editor' ? 'Editor' : 'Viewer'}
                  color={list.myRole === 'editor' ? t.color.primaryFg : t.color.textSecondary}
                />
              </View>
              {isOwner ? (
                <Pressable
                  onPress={() => setOptionsMenuVisible(true)}
                  style={({ pressed }) => [
                    styles.optionsMenuBtn,
                    pressed && styles.optionsMenuBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="List options"
                  hitSlop={8}
                  testID="food-list-options-menu-btn"
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={t.color.textSecondary} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Action Row */}
          <View style={styles.actionRow}>
            {/* Like button */}
            <Pressable
              onPress={() => void handleToggleLike()}
              disabled={isLiking}
              style={({ pressed }) => [
                styles.actionButton,
                list.liked && styles.actionButtonLiked,
                pressed && styles.actionButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${list.liked ? 'Unlike' : 'Like'} list, ${list.likeCount} likes`}
              testID="food-list-like-btn"
            >
              <Ionicons
                name={list.liked ? 'heart' : 'heart-outline'}
                size={16}
                color={list.liked ? t.color.danger : t.color.textSecondary}
              />
              <Text style={[styles.actionButtonText, list.liked && styles.actionButtonTextLiked]}>
                {list.likeCount}
              </Text>
            </Pressable>

            {/* Save button (non-owners only) */}
            {!isOwner ? (
              <Pressable
                onPress={() => void handleSave()}
                disabled={isSaving || list.saved}
                style={({ pressed }) => [
                  styles.actionButton,
                  list.saved && styles.actionButtonSaved,
                  pressed && styles.actionButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={list.saved ? 'List saved' : 'Save list'}
                testID="food-list-save-btn"
              >
                <Ionicons
                  name={list.saved ? 'bookmark' : 'bookmark-outline'}
                  size={16}
                  color={list.saved ? t.color.primaryFg : t.color.textSecondary}
                />
                <Text style={[styles.actionButtonText, list.saved && styles.actionButtonTextSaved]}>
                  {list.saved ? 'Saved' : 'Save'}
                </Text>
              </Pressable>
            ) : null}

            {/* Manage sharing button (owner of private list only, Requirement 9.8) */}
            {isOwner && list.visibility === 'private' ? (
              <Pressable
                onPress={() => setManageSharesVisible(true)}
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Manage sharing"
                testID="food-list-manage-sharing-btn"
              >
                <Ionicons name="people-outline" size={16} color={t.color.primaryFg} />
                <Text style={styles.actionButtonText}>Share</Text>
              </Pressable>
            ) : null}

            {/* Checklist mode toggle (owner only, Requirement 13.2) */}
            {isOwner ? (
              <Pressable
                onPress={() => void handleToggleChecklistMode()}
                disabled={isTogglingChecklist}
                style={({ pressed }) => [
                  styles.actionButton,
                  list.isChecklist && styles.actionButtonChecklistActive,
                  pressed && styles.actionButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  list.isChecklist ? 'Stop tracking as a checklist' : 'Track as a checklist'
                }
                testID="food-list-toggle-checklist-btn"
              >
                <Ionicons
                  name={list.isChecklist ? 'checkbox' : 'checkbox-outline'}
                  size={16}
                  color={list.isChecklist ? t.color.primaryFg : t.color.textSecondary}
                />
                <Text
                  style={[
                    styles.actionButtonText,
                    list.isChecklist && styles.actionButtonTextChecklistActive,
                  ]}
                >
                  Checklist
                </Text>
              </Pressable>
            ) : null}

            {/* Pin button (owner only, Requirement 14.6) */}
            {isOwner ? (
              <Pressable
                onPress={() => void handleTogglePinned()}
                disabled={isTogglingPinned}
                style={({ pressed }) => [
                  styles.actionButton,
                  list.pinnedAt !== null && styles.actionButtonPinnedActive,
                  pressed && styles.actionButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={list.pinnedAt !== null ? 'Unpin list' : 'Pin list'}
                testID="food-list-pin-btn"
              >
                <Ionicons
                  name={list.pinnedAt !== null ? 'pin' : 'pin-outline'}
                  size={16}
                  color={list.pinnedAt !== null ? t.color.primaryFg : t.color.textSecondary}
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

        {/* Progress row for Checklist Food List (Requirement 13.10) */}
        {list.isChecklist ? (
          <Card style={styles.progressCard} testID="food-list-progress-row">
            <View style={styles.progressTextRow}>
              <View style={styles.progressLabelGroup}>
                <Ionicons name="checkbox-outline" size={18} color={t.color.primaryFg} />
                <Text style={styles.progressLabel} testID="food-list-progress-text">
                  {`${list.gottenCount ?? 0} of ${list.itemCount} tried`}
                </Text>
              </View>
              <Text style={styles.progressPercent} testID="food-list-progress-percent">
                {list.itemCount > 0
                  ? `${Math.round(((list.gottenCount ?? 0) / list.itemCount) * 100)}%`
                  : '0%'}
              </Text>
            </View>
            <View style={styles.progressBarTrack} testID="food-list-progress-bar-track">
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${
                      list.itemCount > 0
                        ? Math.min(100, Math.round(((list.gottenCount ?? 0) / list.itemCount) * 100))
                        : 0
                    }%`,
                  },
                ]}
                testID="food-list-progress-bar"
              />
            </View>
          </Card>
        ) : null}

        {/* Section Header — "Add items" lives here, beside the Dishes
            title, rather than in the header card's Like/Share/Checklist
            settings row above: it's the primary content-editing action for
            this section, not a property of the list itself. */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            Dishes ({list.items.length})
          </Text>

          {canEdit ? (
            <Pressable
              onPress={() => setRestaurantSearchModalVisible(true)}
              style={[styles.actionButton, styles.addItemsBtn]}
              accessibilityRole="button"
              accessibilityLabel="Add items to this list"
              testID="food-list-add-items-btn"
            >
              <Ionicons name="add" size={20} color={t.color.textOnPrimary} />
              <Text style={styles.addItemsBtnText}>Add items</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Items List. Reordering (owner/editor only) is drag-to-reorder via
            react-native-draggable-flatlist's drag handle, replacing the
            original up/down tap arrows — those read as expand/collapse
            controls rather than a reorder action, an unclear affordance
            this amendment specifically addresses alongside the checklist
            completion styling. */}
        {list.items.length === 0 ? (
          <View style={styles.emptyItemsWrap}>
            <Ionicons name="restaurant-outline" size={40} color={t.color.textSecondary} />
            <Text style={styles.emptyItemsText}>No dishes in this list yet.</Text>
            {canEdit ? (
              <Pressable
                onPress={() => setRestaurantSearchModalVisible(true)}
                style={styles.emptyAddBtn}
              >
                <Text style={styles.emptyAddBtnText}>Add your first dish</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <NestableDraggableFlatList
            data={[...list.items]}
            keyExtractor={(item) => item.foodItemId}
            scrollEnabled={false}
            renderItem={renderDraggableItem}
            extraData={t.scheme}
            onDragEnd={handleDragEnd}
          />
        )}
      </NestableScrollContainer>

      {/* Optional rating prompt on checklist mark-gotten (Requirement 13.15) */}
      <RateOnCheckoffPrompt
        visible={ratingPromptItem !== null}
        foodItemName={ratingPromptItem?.name ?? ''}
        onSkip={() => {
          if (ratingPromptItem) {
            void handleMarkGotten(ratingPromptItem.foodItemId, ratingPromptItem.name);
          }
          setRatingPromptItem(null);
        }}
        onConfirm={(rating) => {
          if (ratingPromptItem) {
            void handleMarkGotten(ratingPromptItem.foodItemId, ratingPromptItem.name, rating);
          }
          setRatingPromptItem(null);
        }}
      />

      {/* Update rating after the fact on completed checklist item (Requirement 13.23) */}
      {editRatingItem ? (
        <RateOnCheckoffPrompt
          visible={Boolean(editRatingItem)}
          foodItemName={editRatingItem.name}
          initialRating={editRatingItem.initialRating}
          onSkip={() => setEditRatingItem(null)}
          onConfirm={(rating) => {
            const target = editRatingItem;
            setEditRatingItem(null);
            if (target?.logId) {
              void handleUpdateRating(target.foodItemId, target.logId, rating);
            }
          }}
        />
      ) : null}

      {/* Action-scoped undo toasts for mark-gotten submissions (Requirement
          13.16-13.18). Rendered as an overlay above the scroll content;
          several can stack simultaneously, each acting only on its own
          submission's log. */}
      {activeUndoToasts.length > 0 ? (
        <View style={styles.undoToastStack} pointerEvents="box-none">
          {activeUndoToasts.map((toast) => (
            <MarkGottenUndoToast
              key={toast.toastKey}
              itemName={toast.itemName}
              onUndo={() => void handleUndoMarkGotten(toast)}
              onDismiss={() => dismissUndoToast(toast.toastKey)}
            />
          ))}
        </View>
      ) : null}
      {/* Options Menu Modal (Requirement 3.5, Property 26) */}
      <Modal
        visible={optionsMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setOptionsMenuVisible(false);
        }}
        testID="food-list-options-menu-modal"
      >
        <Pressable
          style={styles.optionsMenuBackdrop}
          onPress={() => {
            Keyboard.dismiss();
            setOptionsMenuVisible(false);
          }}
        >
          <View
            style={styles.optionsMenuContainer}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.optionsMenuHeader}>
              <Text style={styles.optionsMenuTitle}>List Options</Text>
              <Text style={styles.optionsMenuSubtitle} numberOfLines={1}>{list.name}</Text>
            </View>

            <View style={styles.optionsMenuDivider} />

            {/* Visibility Toggle Option */}
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setOptionsMenuVisible(false);
                void handleToggleVisibility();
              }}
              style={({ pressed }) => [
                styles.optionsMenuItem,
                pressed && styles.optionsMenuItemPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Make list ${list.visibility === 'public' ? 'private' : 'public'}`}
              testID="food-list-option-visibility-btn"
            >
              <Ionicons
                name={list.visibility === 'public' ? 'lock-closed-outline' : 'globe-outline'}
                size={20}
                color={t.color.textPrimary}
              />
              <Text style={styles.optionsMenuItemText}>
                Make {list.visibility === 'public' ? 'Private' : 'Public'}
              </Text>
            </Pressable>

            {/* Rename Option */}
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setOptionsMenuVisible(false);
                setRenameValue(list.name);
                setRenameModalVisible(true);
              }}
              style={({ pressed }) => [
                styles.optionsMenuItem,
                pressed && styles.optionsMenuItemPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Rename list"
              testID="food-list-option-rename-btn"
            >
              <Ionicons name="pencil-outline" size={20} color={t.color.textPrimary} />
              <Text style={styles.optionsMenuItemText}>Rename List</Text>
            </Pressable>

            {/* Delete Option */}
            <Pressable
              onPress={promptDeleteList}
              style={({ pressed }) => [
                styles.optionsMenuItem,
                pressed && styles.optionsMenuItemPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete list"
              testID="food-list-option-delete-btn"
            >
              <Ionicons name="trash-outline" size={20} color={t.color.danger} />
              <Text style={[styles.optionsMenuItemText, styles.optionsMenuItemDangerText]}>
                Delete List
              </Text>
            </Pressable>

            <View style={styles.optionsMenuDivider} />

            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setOptionsMenuVisible(false);
              }}
              style={styles.optionsMenuCancelBtn}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.optionsMenuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Rename Modal (Requirement 3.5, Property 26) */}
      <Modal
        visible={renameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          Keyboard.dismiss();
          setRenameModalVisible(false);
        }}
        testID="rename-food-list-modal"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.renameModalBackdrop}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              Keyboard.dismiss();
              setRenameModalVisible(false);
            }}
          />
          <View
            style={styles.renameModalContainer}
            onStartShouldSetResponder={() => true}
          >
            <Text style={styles.renameModalTitle}>Rename List</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="List name"
              placeholderTextColor={t.color.textSecondary}
              keyboardAppearance={t.scheme}
              style={styles.renameInput}
              autoFocus
              testID="rename-food-list-input"
            />
            <View style={styles.renameModalActions}>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setRenameModalVisible(false);
                }}
                style={styles.renameCancelBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel renaming"
                testID="cancel-rename-food-list-btn"
              >
                <Text style={styles.renameCancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleRenameList()}
                disabled={isRenaming || !renameValue.trim()}
                style={[
                  styles.renameSubmitBtn,
                  (!renameValue.trim() || isRenaming) && styles.renameSubmitBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save new list name"
                testID="save-rename-food-list-btn"
              >
                <Text style={styles.renameSubmitBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Manage Sharing Sheet */}
      <ManageFoodListSharesSheet
        foodListId={foodListId}
        visible={manageSharesVisible}
        onClose={() => setManageSharesVisible(false)}
      />

      {/* Entry Point 2: Restaurant Search Modal */}
      <Modal
        visible={restaurantSearchModalVisible}
        animationType="slide"
        transparent
        onRequestClose={handleCloseRestaurantSearch}
        testID="restaurant-search-modal"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.modalBackdrop,
            Platform.OS === 'android' && restaurantSearchKeyboardInset > 0
              ? { paddingBottom: restaurantSearchKeyboardInset }
              : null,
          ]}
        >
          <View
            testID="restaurant-search-modal-container"
            style={[
              styles.modalContainer,
              Platform.OS === 'android' && restaurantSearchKeyboardInset > 0
                ? { maxHeight: getRestaurantSearchModalHeight(40) }
                : null,
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a Restaurant</Text>
              <Pressable
                onPress={handleCloseRestaurantSearch}
                accessibilityRole="button"
                accessibilityLabel="Close restaurant search"
                testID="close-restaurant-search-btn"
              >
                <Ionicons name="close" size={24} color={t.color.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.searchSection}>
              <Ionicons name="search" size={18} color={t.color.textSecondary} />
              <TextInput
                value={restaurantSearch}
                onChangeText={setRestaurantSearch}
                placeholder="Search restaurants..."
                placeholderTextColor={t.color.textSecondary}
                keyboardAppearance={t.scheme}
                style={styles.searchInput}
                autoCorrect={false}
                testID="restaurant-search-input"
              />
              {restaurantSearch.length > 0 ? (
                <Pressable
                  onPress={() => {
                    setRestaurantSearch('');
                    setDebouncedRestaurantSearch('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search text"
                  testID="restaurant-search-clear-btn"
                  style={styles.clearSearchBtn}
                >
                  <Ionicons name="close-circle" size={18} color={t.color.textSecondary} />
                </Pressable>
              ) : null}
            </View>

            {restaurantSearchQuery.isLoading ||
            (customLocationSearchQuery.isLoading && debouncedRestaurantSearch.trim().length > 0) ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={t.color.primaryFg} testID="restaurant-search-loading" />
              </View>
            ) : restaurantSearchQuery.isError ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyWrapText} testID="restaurant-search-error">
                  Could not load restaurants. Please try again.
                </Text>
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) =>
                  item.kind === 'restaurant' ? item.data.id : `loc-${item.data.id}`
                }
                renderItem={renderSearchResult}
                extraData={t.scheme}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyWrapText}>No restaurants found.</Text>
                    <Pressable
                      onPress={handleOpenCreateLocation}
                      accessibilityRole="button"
                      accessibilityLabel="It's not listed? Add a snack cart or stand"
                      style={({ pressed }) => [
                        styles.notListedBtn,
                        pressed && styles.notListedBtnPressed,
                      ]}
                      testID="restaurant-search-not-listed-btn"
                    >
                      <Ionicons name="add-circle-outline" size={18} color={t.color.primaryFg} />
                      <Text style={styles.notListedBtnText}>
                        It&apos;s not listed? Add a snack cart or stand
                      </Text>
                    </Pressable>
                  </View>
                }
                ListFooterComponent={
                  searchResults.length > 0 ? (
                    <Pressable
                      onPress={handleOpenCreateLocation}
                      accessibilityRole="button"
                      accessibilityLabel="Can't find a snack cart or stand? Add it here"
                      style={({ pressed }) => [
                        styles.notListedFooterBtn,
                        pressed && styles.notListedFooterBtnPressed,
                      ]}
                      testID="restaurant-search-footer-not-listed-btn"
                    >
                      <Ionicons name="add-circle-outline" size={16} color={t.color.primaryFg} />
                      <Text style={styles.notListedFooterBtnText}>
                        Can&apos;t find a snack cart or stand? Add it here
                      </Text>
                    </Pressable>
                  ) : null
                }
                contentContainerStyle={styles.restaurantListContent}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Entry Point 2: FoodItemPickerModal scoped to selected restaurant or location */}
      {selectedExperience || selectedLocation ? (
        <FoodItemPickerModal
          experienceId={selectedExperience?.id}
          locationId={selectedLocation?.id}
          mode="addToLists"
          visible={pickerModalVisible}
          existingItemIds={list?.items.map((i) => i.foodItemId)}
          isSubmittingSelection={isAddingItems}
          onClose={() => {
            setPickerModalVisible(false);
            setSelectedExperience(null);
            setSelectedLocation(null);
          }}
          onConfirmSelection={(items) => void handleConfirmAddItems(items)}
        />
      ) : null}

      {/* Entry Point 2: Create User-Submitted Location Modal for snack carts/stands */}
      <CreateLocationModal
        park="Magic Kingdom"
        visible={createLocationModalVisible}
        onClose={() => setCreateLocationModalVisible(false)}
        onLocationSelected={handleLocationSelected}
      />
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: t.spacing.md,
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
    color: t.color.textPrimary,
  },
  unavailableBody: {
    fontSize: 15,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 12,
    backgroundColor: t.color.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: t.radius.md,
  },
  backBtnText: {
    color: t.color.textOnPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  undoToastStack: {
    position: 'absolute',
    left: t.spacing.md,
    right: t.spacing.md,
    bottom: t.spacing.lg,
    gap: 8,
  },
  staleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FOOD_LIST_DETAIL[t.scheme].staleNoticeBg,
    padding: 10,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.primaryFg,
  },
  staleNoticeText: {
    fontSize: 13,
    color: t.color.primaryFg,
    fontWeight: '500',
    flex: 1,
  },
  celebrationCard: {
    backgroundColor: FOOD_LIST_DETAIL[t.scheme].celebrationBg,
    borderWidth: 1,
    borderColor: t.color.starRating,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    gap: 6,
  },
  celebrationTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  celebrationIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  celebrationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: FOOD_LIST_DETAIL[t.scheme].celebrationTitle,
  },
  celebrationDismissBtn: {
    padding: 4,
  },
  celebrationMessage: {
    fontSize: 14,
    color: FOOD_LIST_DETAIL[t.scheme].celebrationMessage,
    fontWeight: '500',
  },
  progressCard: {
    padding: t.spacing.md,
    gap: 8,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    // Data mark on the surfaceAlt track (non-text graphics rule) → primaryFg.
    backgroundColor: t.color.primaryFg,
    borderRadius: t.radius.pill,
  },
  headerCard: {
    padding: t.spacing.md,
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
    color: t.color.textPrimary,
  },
  metaText: {
    fontSize: 11,
    color: t.color.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: t.radius.pill,
    backgroundColor: withAlpha(t.color.primary, 0.08),
  },
  visibilityBadgePressed: {
    opacity: 0.7,
  },
  visibilityBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  roleBadgeContainer: {
    marginTop: 2,
  },
  headerTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionsMenuBtn: {
    padding: 6,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsMenuBtnPressed: {
    opacity: 0.7,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 5,
    rowGap: 6,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonLiked: {
    backgroundColor: FOOD_LIST_DETAIL[t.scheme].likedBg,
  },
  actionButtonSaved: {
    backgroundColor: withAlpha(t.color.primary, 0.1),
  },
  actionButtonChecklistActive: {
    backgroundColor: withAlpha(t.color.primary, 0.1),
  },
  actionButtonPinnedActive: {
    backgroundColor: withAlpha(t.color.primary, 0.1),
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  actionButtonTextLiked: {
    color: t.color.danger,
  },
  actionButtonTextSaved: {
    color: t.color.primaryFg,
  },
  actionButtonTextChecklistActive: {
    color: t.color.primaryFg,
  },
  actionButtonTextPinned: {
    color: t.color.primaryFg,
  },
  optionsMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.spacing.lg,
  },
  optionsMenuContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    ...t.shadow.card,
  },
  optionsMenuHeader: {
    paddingVertical: 4,
    gap: 2,
  },
  optionsMenuTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  optionsMenuSubtitle: {
    fontSize: 13,
    color: t.color.textSecondary,
  },
  optionsMenuDivider: {
    height: 1,
    backgroundColor: t.color.border,
    marginVertical: 8,
  },
  optionsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: t.radius.md,
  },
  optionsMenuItemPressed: {
    backgroundColor: t.color.surfaceAlt,
  },
  optionsMenuItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  optionsMenuItemDangerText: {
    color: t.color.danger,
  },
  optionsMenuCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: t.radius.md,
  },
  optionsMenuCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  renameModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.spacing.lg,
  },
  renameModalContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    gap: 14,
    ...t.shadow.card,
  },
  renameModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  renameInput: {
    fontSize: 15,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  renameModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  renameCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: t.radius.md,
  },
  renameCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  renameSubmitBtn: {
    backgroundColor: t.color.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: t.radius.md,
  },
  renameSubmitBtnDisabled: {
    opacity: 0.5,
  },
  renameSubmitBtnText: {
    color: t.color.textOnPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  addItemsBtn: {
    backgroundColor: t.color.primary,
  },
  addItemsBtnText: {
    color: t.color.textOnPrimary,
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
    color: t.color.textPrimary,
  },
  emptyItemsWrap: {
    padding: 36,
    alignItems: 'center',
    gap: 8,
  },
  emptyItemsText: {
    fontSize: 15,
    color: t.color.textSecondary,
  },
  emptyAddBtn: {
    marginTop: 8,
    backgroundColor: t.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: t.radius.md,
  },
  emptyAddBtnText: {
    color: t.color.textOnPrimary,
    fontWeight: '600',
  },
  itemCard: {
    padding: 12,
    // `NestableDraggableFlatList` renders each row inside its own internal
    // list, as ONE opaque child of `content` — the parent's `gap: 12`
    // (which correctly spaced every row back when they were direct mapped
    // siblings of `content`) no longer reaches inside it. Space rows here
    // instead, directly on each row's own style.
    marginBottom: 12,
  },
  itemCardDragging: {
    opacity: 0.85,
    ...t.shadow.card,
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
  // Trailing completion badge (Requirement 13.14, 13.19) — replaces the
  // old leading circle indicator entirely. No leading position, no
  // checkbox-shaped silhouette, so it never reads as a two-way toggle;
  // it's purely a status readout, with undo handled solely by the
  // separate action-scoped toast.
  checkOffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.primaryFg,
    backgroundColor: 'transparent',
    marginLeft: 8,
  },
  checkOffBtnPressed: {
    opacity: 0.7,
    backgroundColor: withAlpha(t.color.primary, 0.08),
  },
  checkOffBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  gottenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: t.radius.pill,
    backgroundColor: withAlpha(t.color.primary, 0.12), // muted tint of the primary token
    marginLeft: 8,
  },
  gottenBadgePressed: {
    opacity: 0.7,
  },
  gottenBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  itemLocation: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 11,
    fontWeight: '500',
    color: t.color.textSecondary,
    marginTop: 2,
  },
  attributionLabel: {
    fontSize: 11,
    color: t.color.primaryFg,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: t.spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: t.color.background,
    borderRadius: t.radius.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: t.color.textPrimary,
  },
  clearSearchBtn: {
    padding: 4,
  },
  loadingWrap: {
    padding: 32,
    alignItems: 'center',
  },
  restaurantListContent: {
    paddingVertical: 8,
  },
  restaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: t.spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  restaurantRowPressed: {
    backgroundColor: t.color.surfaceAlt,
  },
  restaurantRowText: {
    flex: 1,
  },
  locationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  restaurantRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  restaurantRowMeta: {
    fontSize: 11,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyWrapText: {
    color: t.color.textSecondary,
    fontSize: 13,
  },
  notListedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  notListedBtnPressed: {
    opacity: 0.7,
  },
  notListedBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  notListedFooterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: t.spacing.md,
    marginHorizontal: t.spacing.md,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  notListedFooterBtnPressed: {
    opacity: 0.7,
  },
  notListedFooterBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
}));
