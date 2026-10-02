// Feature: disney-world-tracker, Task 16.3 — Experience detail screen
//                         + Task 17.1 — Completion control wiring
//                         + Task 17.3 — Note control wiring
//
// Validates: Requirements R1.22, R2.4, R4.5, R4.6, R5.3, R5.4, R5.5, R5.6,
//            R5.7, R5.8, R5.9, R10.5, R10.6
//
// Behavior summary:
//   - Loads the Experience detail (R1.22) from `GET /catalog/:experienceId`
//     and renders name, Park, category, and description.
//   - Loads the signed-in User's own Completion / Rating / Note in parallel;
//     each fetch swallows the corresponding `*_not_found` ApiError into
//     `null` so the empty states (R2.4, R4.6, R5.9) can be rendered through
//     the same render path as the populated states.
//   - Loads `GET /experiences/:id/aggregate-rating`. The `count >= 3`
//     threshold gating happens at the server (R10.4): when the threshold is
//     not met, the response carries `value: null` and the screen renders
//     "Not enough ratings yet" (R10.6); otherwise the one-decimal mean
//     plus the rating count are shown (R10.5).
//   - The embedded CompletionControls / RatingControl / NoteControl own the
//     mutation flows and invalidate the relevant queries through `onMutated`.
//
// Styling: uses the shared "Magical / Whimsical" theme — a compact gradient
// header carrying the Experience name with its Park subtitle and category
// glyph, each section wrapped in a `Card` with a `SectionLabel`, and the
// Park / category surfaced as themed `Badge`s. Empty "nothing yet" states
// use calm muted text; only genuine load errors use danger. See
// `theme/theme.ts` and `theme/components.tsx`.

import React from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type {
  AggregateRatingDTO,
  AreaType,
  CompletionDTO,
  ErrorCode,
  ExperienceCategory,
  ExperienceVisitHistoryDTO,
  FacetValueDTO,
  FoodItemDTO,
  FoodItemLogWithContextDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  LiveDetailResponseDTO,
  MealPeriodDTO,
  MenuDTO,
  NoteDTO,
  Park,
  RatingDTO,
  ResortDTO,
  TripDTO,
  WhyThisDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import {
  buildExperienceShareParams,
  isExperienceShareEntryEnabled,
} from './shareEntryPoint';
import { buildTagGroups } from './infoTags';
import FoodItemPickerModal from './FoodItemPickerModal';
import LogFoodItemModal from './LogFoodItemModal';
import RestaurantFoodLogsSheet from './RestaurantFoodLogsSheet';
import AddToListsSheet from '../foodLists/AddToListsSheet';
import AddToExperienceListsSheet from '../experienceLists/AddToExperienceListsSheet';
import AddToTripPickerSheet from './AddToTripPickerSheet';
import QuickSpecsRow from './QuickSpecsRow';
import LensSwitcher from './LensSwitcher';
import TodayInParkLens from './TodayInParkLens';
import ResortGuideSection, {
  resolveFallbackResortMeta,
} from './ResortGuideSection';
import PassportAndLoreLens from './PassportAndLoreLens';
import FloatingActionDock from './FloatingActionDock';
import LogVisitModal from './LogVisitModal';
import RateExperienceModal from './RateExperienceModal';
import { getTodayWdwDate } from './live/parkTime';
import { isQuickServiceDining, liveSectionFor, NO_LIVE_SHAPE } from './gating';
import FavoriteToggle from './FavoriteToggle';
import { useFavoritedExperiences } from './useFavoritedExperiences';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of `GET /catalog/:experienceId`. Mirrors `ExperienceDetailResponse`
 * in `apps/api/src/services/catalog/routes.ts`. `id` is included alongside
 * the four R1.22 display fields because the client uses it as the cache
 * key for completion, rating, note, and aggregate fetches.
 */
interface ExperienceDetailDTO {
  readonly id: string;
  readonly name: string;
  // Nullable to match the shared canonical `ExperienceDetailDTO`/`Experience`
  // wire contract: a Resort's own representing row (`category === 'Resort'`)
  // carries no owning Park — it isn't inside a specific theme park (R4.14,
  // R4.15) — so `park` is `null` for that row-shape in real persisted data.
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly description: string;
  readonly imageUrl: string | null;
  /**
   * Enrichment fields surfaced as Info_Tags (R9.2-R9.7). Each is present only
   * when persisted upstream, mirroring `ExperienceDTO`/`ExperienceDetailResponse`;
   * `buildInfoTags` omits any that are absent or empty (R9.8).
   */
  readonly areaType: AreaType;
  readonly resortId?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly accessibility?: readonly string[];
  readonly priceTier?: string | null;
  readonly mealPeriods?: readonly MealPeriodDTO[];
  readonly land?: string | null;
  /**
   * Dining menus surfaced on the detail response for a Restaurant_Experience,
   * mirroring the backend `ExperienceDetailResponse.menus` (R3.1). Present only
   * when the restaurant has one or more menus available; omitted otherwise.
   */
  readonly menus?: readonly MenuDTO[];
  /**
   * Facet enrichment surfaced as Info_Tags / a Why_This section (R11). Each is
   * present only when persisted upstream, mirroring `ExperienceDTO` /
   * `ExperienceDetailResponse`; `buildInfoTags` and the screen omit any that are
   * absent or empty (R11.5).
   */
  readonly heightRequirement?: HeightRequirementDTO | null;
  readonly groupedFacets?: GroupedFacetsDTO;
  readonly physicalConsiderations?: readonly FacetValueDTO[];
  readonly interestFacets?: GroupedFacetsDTO;
  readonly whyThis?: WhyThisDTO | null;
  readonly subType?: string | null;
  /**
   * Verified Disney dining-page URL for restaurants that accept reservations (R6.5, R7.1).
   * Present only when populated in the curated seed; omitted otherwise.
   */
  readonly diningUrl?: string | null;
  readonly representsResortId?: string | null;
  readonly resortArea?: string | null;
  readonly tier?: string | null;
  readonly featurePool?: string | null;
  readonly transportationModes?: readonly string[];
  readonly recreation?: readonly any[];
  readonly transitTimes?: Record<string, number>;
  readonly architecturalLore?: readonly any[];
}

/** Wire shape for `GET /resorts`; only the fields needed to resolve a name. */
interface ResortListResponse {
  readonly resorts: readonly ResortDTO[];
}

type ExperienceDetailRouteProp = RouteProp<
  RootStackParamList,
  'ExperienceDetail'
>;

type ExperienceDetailNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'ExperienceDetail'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Issue a GET that translates a single domain `*_not_found` error code into
 * `null` (for the corresponding empty-state branch) while letting every
 * other failure propagate so React Query can mark the query as errored.
 *
 * The shared error catalog uses dedicated codes per resource
 * (`completion_not_found`, `rating_not_found`, `note_not_found`) so we
 * filter on the precise code rather than on HTTP status — this keeps the
 * behavior aligned with the privacy and uniformity rules of the error
 * envelope (an unrelated 404 from a misrouted request still surfaces as
 * an error).
 */
async function fetchOrNullOnCode<T>(
  path: string,
  notFoundCode: ErrorCode,
): Promise<T | null> {
  try {
    return await apiRequest<T>('GET', path);
  } catch (err) {
    if (err instanceof ApiError && err.code === notFoundCode) {
      return null;
    }
    throw err;
  }
}

/**
 * Render a category enum literal as user-facing text. The enum string for
 * "Character Meet" is `Character_Meet` per the shared `ExperienceCategory`
 * union (see `packages/shared/src/enums.ts`); the App should not surface
 * the underscore.
 */
function categoryLabel(category: ExperienceCategory): string {
  return category.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExperienceDetailScreen(): JSX.Element {
  const route = useRoute<ExperienceDetailRouteProp>();
  const navigation = useNavigation<ExperienceDetailNavigationProp>();
  const { experienceId } = route.params;
  const initialLens = (route.params as any)?.initialLens as 'today' | 'passport' | undefined;
  const encodedId = encodeURIComponent(experienceId);

  const queryClient = useQueryClient();
  const [foodPickerVisible, setFoodPickerVisible] = React.useState(false);
  const [selectedFoodItem, setSelectedFoodItem] = React.useState<FoodItemDTO | null>(null);
  const [logFoodModalVisible, setLogFoodModalVisible] = React.useState(false);
  const [scopedFoodLogsVisible, setScopedFoodLogsVisible] = React.useState(false);
  const [addToListsPickerVisible, setAddToListsPickerVisible] = React.useState(false);
  const [addToListsSheetVisible, setAddToListsSheetVisible] = React.useState(false);
  const [itemsToAddToLists, setItemsToAddToLists] = React.useState<readonly FoodItemDTO[]>([]);
  const [addToExperienceListsSheetVisible, setAddToExperienceListsSheetVisible] = React.useState(false);
  // Requirement 18.1: the trip picker's own candidate list, captured at the
  // moment "Add to Trip" is chosen so the sheet's contents can't drift if
  // `tripsData` refetches while it's open.
  const [tripPickerTrips, setTripPickerTrips] = React.useState<readonly TripDTO[]>([]);
  const [tripPickerVisible, setTripPickerVisible] = React.useState(false);
  const [reservationFailed, setReservationFailed] = React.useState(false);
  const [logVisitModalVisible, setLogVisitModalVisible] = React.useState(false);
  const [rateModalVisible, setRateModalVisible] = React.useState(false);

  const favoritedIds = useFavoritedExperiences();
  const isFavorited = favoritedIds.has(experienceId);

  const [activeLens, setActiveLens] = React.useState<'today' | 'passport'>(initialLens ?? 'today');
  const scrollViewRef = React.useRef<ScrollView>(null);

  const handleLensChange = React.useCallback((lens: 'today' | 'passport') => {
    setActiveLens(lens);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const invalidateAfterLogChange = React.useCallback((): void => {
    void queryClient.invalidateQueries({
      queryKey: ['experience-logs', experienceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['experience-completion', experienceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['experience-rating', experienceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['experience-aggregate', experienceId],
    });
    void queryClient.invalidateQueries({
      queryKey: ['scoped-food-item-logs', experienceId],
    });
    void queryClient.invalidateQueries({ queryKey: ['me-stats'] });
  }, [experienceId, queryClient]);

  const { data: tripsData } = useQuery({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<any>('GET', '/me/trips?filter=active'),
  });

  const activeTrip = React.useMemo(() => {
    if (!tripsData) return undefined;
    if (Array.isArray(tripsData)) {
      const activeGroup = tripsData.find((g: any) => g.status === 'active');
      const upcomingGroup = tripsData.find((g: any) => g.status === 'upcoming');
      return activeGroup?.trips?.[0] ?? upcomingGroup?.trips?.[0] ?? undefined;
    }
    const trips = tripsData?.trips;
    if (Array.isArray(trips)) {
      return (
        trips.find((t: any) => t.status === 'active') ??
        trips.find((t: any) => t.status === 'upcoming') ??
        undefined
      );
    }
    return undefined;
  }, [tripsData]);

  // Requirement 18.1: every Trip eligible to receive this Experience — not
  // just the single silently-preferred one `activeTrip` resolves above
  // (which is kept, unchanged, for the separate "already on your plan" check
  // below). Flattens every `active`/`upcoming` status group's Trips into one
  // list for the picker.
  const eligibleTripsForAdd = React.useMemo((): readonly TripDTO[] => {
    if (!tripsData) return [];
    if (Array.isArray(tripsData)) {
      return tripsData
        .filter((g: any) => g.status === 'active' || g.status === 'upcoming')
        .flatMap((g: any) => g.trips ?? []);
    }
    return tripsData?.trips ?? [];
  }, [tripsData]);

  // Requirement 18.1, 18.3: resolves the eligible Trip set and either opens
  // the Trip picker (always, regardless of count — Property 22) or shows the
  // existing "No Active Trip" alert unchanged when there are none.
  const handleAddToPlan = (): void => {
    if (eligibleTripsForAdd.length === 0) {
      Alert.alert(
        'No Active Trip',
        "You don't have an active or upcoming trip yet. Create a trip in the Trips tab to add experiences to your itinerary!",
        [
          {
            text: 'Go to Trips',
            onPress: () => navigation.navigate('Trips' as any),
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    setTripPickerTrips(eligibleTripsForAdd);
    setTripPickerVisible(true);
  };

  // Requirement 18.2: the actual write, unchanged from the pre-Requirement-18
  // `handleAddToPlan` body, now parameterized on the User's picked Trip
  // rather than a silently-derived one.
  const addToTrip = async (tripId: string): Promise<void> => {
    setTripPickerVisible(false);
    const tripToUse = eligibleTripsForAdd.find((t) => t.id === tripId);

    try {
      await apiRequest('POST', `/trips/${tripId}/planned-items`, {
        experienceId,
      });
      void queryClient.invalidateQueries({
        queryKey: ['trips', tripId, 'planned-items'],
      });
      Alert.alert(
        'Added to Trip',
        `✨ ${experience.name} has been added to ${tripToUse?.name || 'your trip'}!`,
      );
    } catch (err: any) {
      Alert.alert('Could Not Add to Trip', err?.message ?? 'Please try again.');
    }
  };

  const { data: plannedItemsData } = useQuery({
    queryKey: ['trips', activeTrip?.id, 'planned-items'] as const,
    queryFn: () => apiRequest<any>('GET', `/trips/${activeTrip?.id}/planned-items`),
    enabled: Boolean(activeTrip?.id),
  });

  const itemForExperience =
    plannedItemsData?.items?.find((item: any) => item.experienceId === experienceId) ??
    (Array.isArray(plannedItemsData)
      ? plannedItemsData.find((item: any) => item.experienceId === experienceId)
      : undefined);

  const handleReserveAction = async (url: string): Promise<void> => {
    try {
      await Linking.openURL(url);
      setReservationFailed(false);
    } catch {
      setReservationFailed(true);
    }
  };

  // React Query's `useQueries` issues every queryFn concurrently and
  // returns a tuple of `UseQueryResult` aligned with the input order.
  // The five reads — catalog detail, own completion, own rating, own
  // note, community aggregate — are independent, so running them in
  // parallel keeps the time-to-content close to the slowest single hop
  const cachedDetail = queryClient.getQueryData<ExperienceDetailDTO>([
    'experience',
    experienceId,
  ]);

  const queries = useQueries({
    queries: [
      {
        queryKey: ['experience', experienceId] as const,
        queryFn: () =>
          apiRequest<ExperienceDetailDTO>('GET', `/catalog/${encodedId}`),
      },
      {
        queryKey: ['experience-completion', experienceId] as const,
        queryFn: () =>
          fetchOrNullOnCode<CompletionDTO>(
            `/me/experiences/${encodedId}/completion`,
            'completion_not_found',
          ),
      },
      {
        queryKey: ['experience-rating', experienceId] as const,
        queryFn: () =>
          fetchOrNullOnCode<RatingDTO>(
            `/me/experiences/${encodedId}/rating`,
            'rating_not_found',
          ),
      },
      {
        queryKey: ['experience-note', experienceId] as const,
        queryFn: () =>
          fetchOrNullOnCode<NoteDTO>(
            `/me/experiences/${encodedId}/note`,
            'note_not_found',
          ),
      },
      {
        queryKey: ['experience-aggregate', experienceId] as const,
        queryFn: () =>
          apiRequest<AggregateRatingDTO>(
            'GET',
            `/experiences/${encodedId}/aggregate-rating`,
          ),
      },
      {
        // The viewer's Visit_History for this Experience (repeat count + logs).
        // `GET /me/experiences/:id/logs` returns a 200 with `repeatCount: 0`
        // and an empty list when nothing is logged yet, so no not-found
        // swallowing is needed (experience-activity-logging R4.1-R4.3).
        queryKey: ['experience-logs', experienceId] as const,
        queryFn: () =>
          apiRequest<ExperienceVisitHistoryDTO>(
            'GET',
            `/me/experiences/${encodedId}/logs`,
          ),
      },
      {
        // Live operational layer (R3.2-R3.5, R7.*). This read is fully
        // independent of the static catalog detail above: a failure here
        // (e.g. a 503 `live_unavailable` when no cached Live_Detail exists)
        // surfaces only the live-unavailable indicator and never blocks the
        // static fields from rendering. The category gate (`liveSectionFor`)
        // decides which — if any — live section consumes this result.
        queryKey: ['experience-live', experienceId] as const,
        queryFn: () =>
          apiRequest<LiveDetailResponseDTO>(
            'GET',
            `/catalog/${encodedId}/live`,
          ),
        enabled: Boolean(
          !cachedDetail ||
            liveSectionFor(cachedDetail.category, NO_LIVE_SHAPE) !== 'none',
        ),
      },
    ],
  });

  const experienceQ = queries[0];
  const completionQ = queries[1];
  const ratingQ = queries[2];
  const noteQ = queries[3];
  const aggregateQ = queries[4];
  const logsQ = queries[5];
  const liveQ = queries[6];

  // Resort name lookup for the specific-Resort Info_Tag (R9.7). Only a
  // `Resort`-area Experience that references a specific Resort needs the
  // Resorts list, so the fetch is gated on the loaded detail — non-Resort
  // detail views never issue this request. When the name is unavailable
  // (list still loading, request failed, or no matching Resort) `resortName`
  // stays `null` and `buildInfoTags` omits the Resort tag (R9.8).
  const detail = experienceQ.data;
  const needsResortName =
    (detail?.areaType === 'Resort' &&
      typeof detail.resortId === 'string' &&
      detail.resortId.length > 0) ||
    detail?.category === 'Resort';
  const resortsQ = useQuery({
    queryKey: ['resorts'] as const,
    queryFn: () => apiRequest<ResortListResponse>('GET', '/resorts'),
    enabled: needsResortName,
  });

  const foodLogsQ = useQuery<readonly FoodItemLogWithContextDTO[]>({
    queryKey: ['scoped-food-item-logs', experienceId] as const,
    queryFn: async () => {
      const res = await apiRequest<readonly FoodItemLogWithContextDTO[]>(
        'GET',
        `/experiences/${encodedId}/food-item-logs/mine`,
      );
      return res ?? [];
    },
    enabled: Boolean(experienceId && experienceQ.data?.category === 'Restaurant'),
  });

  // Block the whole screen on the catalog detail load — the section
  // headers depend on the Experience name and the screen has nothing
  // useful to show without it. The four secondary fetches each render
  // their own loading/empty/populated state inline so the page isn't
  // gated on the slowest hop.
  if (experienceQ.isLoading) {
    return (
      <ScreenContainer>
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (experienceQ.isError || experienceQ.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Experience" icon="map" compact onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <EmptyState
            icon="alert-circle-outline"
            title="We couldn't load this experience"
            body="Please try again later."
          />
          {/* R3.4: even when the static detail fields cannot be rendered, the
              App still surfaces the live-unavailable indicator for the
              Experience. */}
          <LiveUnavailableIndicator />
        </View>
      </ScreenContainer>
    );
  }

  const experience = experienceQ.data;
  const visual = theme.categoryVisual[experience.category];

  // Resolve the referenced Resort's name for the specific-Resort Info_Tag
  // (R9.7); `null` whenever the name is unavailable so the tag is omitted.
  const resortName =
    experience.category === 'Resort'
      ? experience.name
      : needsResortName && experience.resortId != null
        ? resortsQ.data?.resorts.find((r) => r.id === experience.resortId)?.name ?? null
        : null;

  const fallbackResortMeta =
    experience.category === 'Resort'
      ? resolveFallbackResortMeta(experience.name)
      : null;

  const matchedResort: ResortDTO | null = (() => {
    const fromApi = resortsQ.data?.resorts.find(
      (r) =>
        r.id === experience.representsResortId ||
        r.id === experience.resortId ||
        (r.name &&
          experience.name &&
          (r.name.toLowerCase() === experience.name.toLowerCase() ||
            r.name.toLowerCase().includes(experience.name.toLowerCase()) ||
            experience.name.toLowerCase().includes(r.name.toLowerCase()))),
    );

    if (fromApi) {
      if (fallbackResortMeta) {
        return {
          ...fromApi,
          tier: fromApi.tier ?? fallbackResortMeta.tier,
          featurePool: fromApi.featurePool ?? fallbackResortMeta.featurePool,
          transportationModes:
            fromApi.transportationModes && fromApi.transportationModes.length > 0
              ? fromApi.transportationModes
              : fallbackResortMeta.transportationModes,
        };
      }
      return fromApi;
    }

    if (experience.category === 'Resort') {
      return {
        id: experience.representsResortId ?? experience.id,
        name: experience.name,
        description: experience.description,
        tier: (experience.tier as any) ?? fallbackResortMeta?.tier ?? 'Moderate',
        featurePool:
          experience.featurePool ??
          fallbackResortMeta?.featurePool ??
          'Feature Pool',
        transportationModes:
          experience.transportationModes ??
          fallbackResortMeta?.transportationModes ?? ['Bus'],
        recreation: (experience.recreation as any) ?? [],
        transitTimes: experience.transitTimes ?? {},
        architecturalLore: (experience.architecturalLore as any) ?? [],
      } as unknown as ResortDTO;
    }

    return null;
  })();

  const quickSpecsExperience =
    experience.category === 'Resort'
      ? {
          ...experience,
          tier:
            matchedResort?.tier ??
            (experience as any).tier ??
            fallbackResortMeta?.tier,
          featurePool:
            matchedResort?.featurePool ??
            (experience as any).featurePool ??
            fallbackResortMeta?.featurePool,
          transportationModes:
            matchedResort?.transportationModes &&
            matchedResort.transportationModes.length > 0
              ? matchedResort.transportationModes
              : (experience as any).transportationModes &&
                (experience as any).transportationModes.length > 0
              ? (experience as any).transportationModes
              : fallbackResortMeta?.transportationModes,
        }
      : experience;

  const isQuickService =
    experience.category === 'Restaurant' &&
    isQuickServiceDining(experience.subType, experience.groupedFacets);
  const canHaveLive =
    liveSectionFor(experience.category, NO_LIVE_SHAPE) !== 'none';

  // Grouped, relabelled, de-duplicated Tag_Groups (R1). The Location_Group is
  // promoted to its own section directly beneath the header/hero region with
  // the Get_Directions_Action (R4.2, R7.1); the remaining groups (Good to
  // know, Accessibility, Good for) render last, in the same fixed order
  // `buildTagGroups` emits (R7.1). Absent groups are already omitted (R7.5).
  const tagGroups = buildTagGroups(experience, resortName);
  const locationGroup = tagGroups.find((group) => group.id === 'location');
  const remainingGroups = tagGroups.filter((group) => group.id !== 'location');

  // Header subtitle (R20.7 of experience-detail-redesign): the Resort's
  // Geographic Area for a Resort (falling back to Park), or the Park for
  // every other category — omitted entirely (not passed as `undefined`) when
  // neither resolves, so `GradientHeader` never renders a blank subtitle line.
  const headerSubtitle: string | undefined =
    experience.category === 'Resort'
      ? experience.resortArea ?? experience.park ?? undefined
      : experience.park ?? undefined;

  return (
    <ScreenContainer>
      {/* -------------------------------------------------------------- */}
      {/* Header: name + Park subtitle + category glyph (R1.22)          */}
      {/* Plus top-right circular Share action button (R1.1-R1.5)        */}
      {/* -------------------------------------------------------------- */}
      <GradientHeader
        title={experience.name}
        {...(headerSubtitle !== undefined ? { subtitle: headerSubtitle } : {})}
        icon={visual.glyph as keyof typeof Ionicons.glyphMap}
        compact
        onBack={() => navigation.goBack()}
        right={
          <View style={styles.headerRightActions}>
            <FavoriteToggle
              experienceId={experienceId}
              favorited={isFavorited}
              size="large"
            />
            <Pressable
              testID="experience-share-button"
              accessibilityRole="button"
              accessibilityLabel={`Share ${experience.name}`}
              accessibilityState={{
                disabled: !isExperienceShareEntryEnabled({
                  detailLoading: experienceQ.isLoading,
                  ratingLoading: ratingQ.isLoading,
                  noteLoading: noteQ.isLoading,
                }),
              }}
              disabled={
                !isExperienceShareEntryEnabled({
                  detailLoading: experienceQ.isLoading,
                  ratingLoading: ratingQ.isLoading,
                  noteLoading: noteQ.isLoading,
                })
              }
              onPress={() => {
                navigation.navigate(
                  'ShareComposer',
                  buildExperienceShareParams(
                    experience,
                    ratingQ.data ?? null,
                    noteQ.data ?? null,
                  ),
                );
              }}
              style={({ pressed }) => [
                styles.headerActionCircle,
                pressed && styles.cardPressed,
                !isExperienceShareEntryEnabled({
                  detailLoading: experienceQ.isLoading,
                  ratingLoading: ratingQ.isLoading,
                  noteLoading: noteQ.isLoading,
                }) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="share-outline" size={18} color="#ffffff" />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.container, styles.scrollContainerPadding]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        testID="experience-detail"
      >
        {/* Photo Canopy with overlaid Park/Land and Community/Category badges */}
        <ExperienceHero
          imageUrl={experience.imageUrl}
          category={experience.category}
          park={experience.park}
          land={experience.land ?? null}
          resortArea={experience.resortArea ?? null}
          aggregateRating={aggregateQ.data ?? null}
        />

        {/* ------------------------------------------------------------ */}
        {/* Quick Specs Row (R11.3, R20.1)                               */}
        {/* ------------------------------------------------------------ */}
        <QuickSpecsRow experience={quickSpecsExperience} />

        {/* Live retrieval failure indicator (R3.2, R8.4, R20.3, R21.2) */}
        {canHaveLive && liveQ.isError ? <LiveUnavailableIndicator /> : null}

        {/* ------------------------------------------------------------ */}
        {/* Lens Switcher (R11.1-R11.6)                                  */}
        {/* ------------------------------------------------------------ */}
        <LensSwitcher
          activeLens={activeLens}
          onChangeLens={handleLensChange}
          onLensChange={handleLensChange}
          category={experience.category}
          areaType={experience.areaType}
        />

        {/* ------------------------------------------------------------ */}
        {/* Active Lens Content (R11, R13, R14, R17, R18)                */}
        {/* ------------------------------------------------------------ */}
        {/* Active Lens Content (R11, R13, R14, R17, R18, R20.4)         */}
        {/* ------------------------------------------------------------ */}
        {activeLens === 'today' ? (
          experience.category === 'Resort' ? (
            <ResortGuideSection
              experienceId={experience.id}
              experienceName={experience.name}
              resort={matchedResort}
              latitude={experience.latitude}
              longitude={experience.longitude}
            />
          ) : (
            <TodayInParkLens
              experienceId={experience.id}
              experienceName={experience.name}
              category={experience.category}
              diningUrl={experience.diningUrl}
              menus={experience.menus}
              liveDetail={liveQ.data?.liveDetail}
              liveError={liveQ.isError}
              locationGroup={locationGroup}
              latitude={experience.latitude}
              longitude={experience.longitude}
              plannedDate={itemForExperience?.plannedDate ?? null}
              activeTripRange={
                activeTrip
                  ? { startDate: activeTrip.startDate, endDate: activeTrip.endDate }
                  : null
              }
              todayWdw={getTodayWdwDate()}
              onReserve={handleReserveAction}
              reservationFailed={reservationFailed}
              onLogFoodItem={() => setFoodPickerVisible(true)}
              onMyLoggedItems={() => setScopedFoodLogsVisible(true)}
              onAddToList={() => setAddToListsPickerVisible(true)}
              loggedDishesCount={foodLogsQ.data?.length ?? 0}
              isQuickService={isQuickService}
            />
          )
        ) : (
          <PassportAndLoreLens
            experienceId={experienceId}
            experienceName={experience.name}
            category={experience.category}
            description={experience.description}
            whyThis={experience.whyThis}
            menus={experience.menus}
            completionQuery={completionQ}
            ratingQuery={ratingQ}
            noteQuery={noteQ}
            logsQuery={logsQ}
            aggregateQuery={aggregateQ}
            remainingGroups={remainingGroups}
            onLogFoodItem={() => setFoodPickerVisible(true)}
            onMyLoggedItems={() => setScopedFoodLogsVisible(true)}
            onAddToList={() => setAddToListsPickerVisible(true)}
          />
        )}
      </ScrollView>

      {/* -------------------------------------------------------------- */}
      {/* Floating Action Dock (R19; secondary action merged per          */}
      {/* experience-lists R17 — see FloatingActionDock.tsx)              */}
      {/* -------------------------------------------------------------- */}
      <FloatingActionDock
        category={experience.category}
        activeLens={activeLens}
        isQuickService={isQuickService}
        onLogVisit={() => {
          setLogVisitModalVisible(true);
        }}
        onAddToPlan={() => {
          handleAddToPlan();
        }}
        onRateVisit={() => {
          setRateModalVisible(true);
        }}
        onRateMostRecent={() => {
          setRateModalVisible(true);
        }}
        onLogDish={() => {
          setFoodPickerVisible(true);
        }}
        onReserveTable={
          typeof experience.diningUrl === 'string' &&
          experience.diningUrl.trim().length > 0
            ? () => {
                void handleReserveAction(experience.diningUrl as string);
              }
            : undefined
        }
        onAddToExperienceList={() => setAddToExperienceListsSheetVisible(true)}
      />

      {/* Log visit modal */}
      <LogVisitModal
        experienceId={experienceId}
        visible={logVisitModalVisible}
        onClose={() => setLogVisitModalVisible(false)}
        onLogged={invalidateAfterLogChange}
      />

      {/* Rate experience modal */}
      <RateExperienceModal
        experienceId={experienceId}
        experienceName={experience.name}
        visible={rateModalVisible}
        currentRating={ratingQ.data?.value ?? null}
        onClose={() => setRateModalVisible(false)}
        onRated={invalidateAfterLogChange}
      />

      {/* Food item picker modal */}
      <FoodItemPickerModal
        experienceId={experienceId}
        menus={experience.menus}
        visible={foodPickerVisible}
        onClose={() => setFoodPickerVisible(false)}
        onSelectFoodItem={(item) => {
          setSelectedFoodItem(item);
          setFoodPickerVisible(false);
          setLogFoodModalVisible(true);
        }}
      />

      {/* Log food item modal */}
      <LogFoodItemModal
        foodItem={selectedFoodItem}
        visible={logFoodModalVisible}
        onClose={() => {
          setLogFoodModalVisible(false);
          setSelectedFoodItem(null);
        }}
        onLogged={() => {
          void queryClient.invalidateQueries({
            queryKey: ['experience-food-items', experienceId],
          });
          void queryClient.invalidateQueries({
            queryKey: ['scoped-food-item-logs', experienceId],
          });
          if (selectedFoodItem) {
            void queryClient.invalidateQueries({
              queryKey: ['food-item-logs', selectedFoodItem.id],
            });
          }
        }}
      />

      {/* Food item picker modal in addToLists mode (Entry Point 1) */}
      <FoodItemPickerModal
        experienceId={experienceId}
        menus={experience.menus}
        mode="addToLists"
        visible={addToListsPickerVisible}
        onClose={() => setAddToListsPickerVisible(false)}
        onConfirmSelection={(items) => {
          setItemsToAddToLists(items);
          setAddToListsPickerVisible(false);
          setAddToListsSheetVisible(true);
        }}
      />

      {/* Add to Lists Sheet */}
      <AddToListsSheet
        visible={addToListsSheetVisible}
        foodItems={itemsToAddToLists}
        onClose={() => {
          setAddToListsSheetVisible(false);
          setItemsToAddToLists([]);
        }}
      />

      {/* Restaurant food logs sheet (Requirement 9.4) */}
      <RestaurantFoodLogsSheet
        experienceId={experienceId}
        visible={scopedFoodLogsVisible}
        onClose={() => setScopedFoodLogsVisible(false)}
      />

      {/* Trip picker for "Add to Trip" (experience-lists R18) */}
      <AddToTripPickerSheet
        visible={tripPickerVisible}
        trips={tripPickerTrips}
        onSelect={(tripId) => {
          void addToTrip(tripId);
        }}
        onClose={() => setTripPickerVisible(false)}
      />

      {/* Add to Experience_Lists Sheet (experience-lists Entry Point 1, R9.1) */}
      <AddToExperienceListsSheet
        visible={addToExperienceListsSheetVisible}
        experienceId={experienceId}
        experienceName={experience.name}
        onClose={() => setAddToExperienceListsSheetVisible(false)}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Hero image
// ---------------------------------------------------------------------------

/**
 * Full-width hero image canopy for the detail view. Shows the sourced photo when
 * present; otherwise a category-tinted placeholder with the category glyph.
 * Overlays a dark gradient scrim and bottom land and community-rating badges.
 */
function ExperienceHero({
  imageUrl,
  category,
  park,
  land,
  resortArea,
  aggregateRating,
}: {
  readonly imageUrl: string | null;
  readonly category: ExperienceCategory;
  readonly park: Park | null;
  readonly land?: string | null;
  readonly resortArea?: string | null;
  readonly aggregateRating: AggregateRatingDTO | null;
}): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  const visual = theme.categoryVisual[category];
  const hasImage = imageUrl != null && imageUrl.length > 0 && !failed;
  // A Resort's own representing row carries no `land`/`park` (it isn't inside
  // a specific park or land) — its Geographic Area is the resortArea instead.
  // Every other category keeps the existing land-then-park precedence.
  const displayLand =
    category === 'Resort'
      ? resortArea && resortArea.trim().length > 0
        ? resortArea.trim()
        : park ?? undefined
      : land && land.trim().length > 0
        ? land.trim()
        : park ?? undefined;

  return (
    <View style={styles.heroCard}>
      {hasImage ? (
        <Image
          source={{ uri: imageUrl as string }}
          style={styles.heroImage}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
          testID="experience-hero-image"
        />
      ) : (
        <View
          style={[styles.heroImage, styles.heroPlaceholder, { backgroundColor: visual.tint }]}
          testID="experience-hero-placeholder"
        >
          <Ionicons
            name={visual.glyph as keyof typeof Ionicons.glyphMap}
            size={48}
            color={theme.color.textOnPrimary}
          />
        </View>
      )}

      {/* Gradient scrim overlay across the bottom */}
      <LinearGradient
        colors={['transparent', 'rgba(20, 8, 36, 0.88)']}
        style={styles.heroScrim}
        pointerEvents="none"
      />

      {/* Overlaid badges at bottom of hero photo */}
      <View style={styles.heroBadgesRow}>
        <View style={styles.heroLandPill} testID="experience-park-badge">
          <Text
            style={styles.heroLandPillText}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            📍{displayLand !== undefined ? ` ${displayLand}` : ''}
          </Text>
        </View>

        {aggregateRating?.value != null ? (
          <View
            style={styles.heroRatingPill}
            testID="experience-category-badge"
            accessibilityLabel={`Community rating: ${aggregateRating.value.toFixed(1)} out of 10 based on ${aggregateRating.count} guest ratings`}
          >
            <Text style={styles.heroRatingPillText}>
              ★ {aggregateRating.value.toFixed(1)}{' '}
              <Text style={styles.heroRatingCountText}>
                ({aggregateRating.count} {aggregateRating.count === 1 ? 'rating' : 'ratings'})
              </Text>
            </Text>
          </View>
        ) : (
          <View style={styles.heroCategoryPill} testID="experience-category-badge">
            <Ionicons
              name={visual.glyph as keyof typeof Ionicons.glyphMap}
              size={11}
              color="#ffffff"
            />
            <Text style={styles.heroCategoryPillText}>{categoryLabel(category)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fallback Indicator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Live operational section
// ---------------------------------------------------------------------------

/**
 * The "live information currently unavailable" indicator (R3.2, R3.4). Shown
 * when the live read fails (e.g. a 503 `live_unavailable` with no cached
 * Live_Detail) — the static detail fields remain visible above it (R3.3), and
 * it is also surfaced when the static detail itself cannot be rendered (R3.4).
 */
function LiveUnavailableIndicator(): JSX.Element {
  return (
    <Card style={styles.section} testID="live-unavailable">
      <EmptyState
        icon="cloud-offline-outline"
        title="Live information currently unavailable"
        body="We couldn't load live details right now. Please try again later."
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 12,
  },
  scrollContainerPadding: {
    paddingBottom: 110,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  headerActionCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPressed: {
    opacity: 0.75,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  shareButton: {
    marginTop: theme.spacing.xs,
  },
  heroCard: {
    position: 'relative',
    width: '100%',
    height: 195,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: theme.color.surfaceAlt,
    shadowColor: '#1f1235',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 4,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
  },
  heroBadgesRow: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // A long Geographic Area (e.g. "Disney's Animal Kingdom Resort Area")
    // must not balloon past the category/rating pill on the same row — cap it
    // and let the text ellipsize instead of crowding or wrapping the row.
    flexShrink: 1,
    maxWidth: '62%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  heroLandPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#371756',
  },
  heroRatingPill: {
    backgroundColor: '#f6c343',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 2,
  },
  heroRatingPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#3d1c5c',
  },
  heroRatingCountText: {
    fontSize: 9.5,
    fontWeight: '700',
    opacity: 0.9,
  },
  heroCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(91, 42, 134, 0.85)',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  heroCategoryPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#ffffff',
  },
  mapPreviewWrap: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPreview: {
    width: '100%',
    height: 180,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceAlt,
  },
  mapPin: {
    position: 'absolute',
    // Nudge up by roughly half the icon height so the pin's tip (not its
    // center) rests on the coordinate at the image center.
    marginTop: -16,
    // A drop shadow keeps the pin legible against the varied colors of the
    // satellite imagery basemap.
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  section: {
    gap: theme.spacing.md,
  },
  bodyText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    lineHeight: 20,
  },
  empty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  aggregateBlock: {
    gap: theme.spacing.xs,
  },
  aggregateValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  directionsButtonText: {
    ...theme.typography.button,
    color: theme.color.textOnPrimary,
  },
  foodItemButtonsRow: {
    gap: theme.spacing.sm,
  },
  aggregateValue: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
  },
  aggregateMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.color.danger,
  },
  reservationActionWrap: {
    gap: theme.spacing.xs,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
