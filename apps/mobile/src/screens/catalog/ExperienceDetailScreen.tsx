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
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  LiveDetailResponseDTO,
  MealPeriodDTO,
  MenuDTO,
  NoteDTO,
  Park,
  RatingDTO,
  ResortDTO,
  WhyThisDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SectionLabel,
  SecondaryButton,
} from '../../theme/components';
import {
  buildExperienceShareParams,
  isExperienceShareEntryEnabled,
} from './shareEntryPoint';
import { formatCommunityAggregate } from './aggregateFormat';
import MenuSummaryCard from './MenuSummaryCard';
import YourVisitCard from './YourVisitCard';
import AboutSection from './AboutSection';
import WaitInsightsSection from './WaitInsightsSection';
import { buildTagGroups } from './infoTags';
import type { TagGroup } from './infoTags';
import type { DirectionsPlatform } from './directions';
import { directionsUrl, hasValidCoordinates, staticMapUrl } from './directions';
import { liveSectionFor, NO_LIVE_SHAPE, type LiveShape } from './gating';
import RideLiveSection from './live/RideLiveSection';
import ShowtimesSection from './live/ShowtimesSection';
import DiningSection from './live/DiningSection';

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
  readonly park: Park;
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
  const encodedId = encodeURIComponent(experienceId);

  // React Query's `useQueries` issues every queryFn concurrently and
  // returns a tuple of `UseQueryResult` aligned with the input order.
  // The five reads — catalog detail, own completion, own rating, own
  // note, community aggregate — are independent, so running them in
  // parallel keeps the time-to-content close to the slowest single hop
  // rather than the sum.
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
      },
    ],
  });

  const experienceQ = queries[0];
  const completionQ = queries[1];
  const ratingQ = queries[2];
  const noteQ = queries[3];
  const aggregateQ = queries[4];
  const liveQ = queries[5];

  // Resort name lookup for the specific-Resort Info_Tag (R9.7). Only a
  // `Resort`-area Experience that references a specific Resort needs the
  // Resorts list, so the fetch is gated on the loaded detail — non-Resort
  // detail views never issue this request. When the name is unavailable
  // (list still loading, request failed, or no matching Resort) `resortName`
  // stays `null` and `buildInfoTags` omits the Resort tag (R9.8).
  const detail = experienceQ.data;
  const needsResortName =
    detail?.areaType === 'Resort' &&
    typeof detail.resortId === 'string' &&
    detail.resortId.length > 0;
  const resortsQ = useQuery({
    queryKey: ['resorts'] as const,
    queryFn: () => apiRequest<ResortListResponse>('GET', '/resorts'),
    enabled: needsResortName,
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
    needsResortName && experience.resortId != null
      ? resortsQ.data?.resorts.find((r) => r.id === experience.resortId)?.name ??
        null
      : null;

  // Grouped, relabelled, de-duplicated Tag_Groups (R1). The Location_Group is
  // promoted to its own section directly beneath the header/hero region with
  // the Get_Directions_Action (R4.2, R7.1); the remaining groups (Good to
  // know, Accessibility, Good for) render last, in the same fixed order
  // `buildTagGroups` emits (R7.1). Absent groups are already omitted (R7.5).
  const tagGroups = buildTagGroups(experience, resortName);
  const locationGroup = tagGroups.find((group) => group.id === 'location');
  const remainingGroups = tagGroups.filter((group) => group.id !== 'location');

  return (
    <ScreenContainer>
      {/* -------------------------------------------------------------- */}
      {/* Header: name + Park subtitle + category glyph (R1.22)          */}
      {/* -------------------------------------------------------------- */}
      <GradientHeader
        title={experience.name}
        subtitle={experience.park}
        icon={visual.glyph as keyof typeof Ionicons.glyphMap}
        compact
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.container}
        testID="experience-detail"
      >
        {/* Hero image (sourced photo or category placeholder). */}
        <ExperienceHero
          imageUrl={experience.imageUrl}
          category={experience.category}
        />

        {/* Park + category badges, surfaced as themed pills. */}
        <View style={styles.badgeRow}>
          <Badge
            label={experience.park}
            color={theme.parkAccent[experience.park]}
            icon="location"
            testID="experience-park-badge"
          />
          <Badge
            label={categoryLabel(experience.category)}
            color={visual.tint}
            icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            testID="experience-category-badge"
          />
        </View>

        {/* ------------------------------------------------------------ */}
        {/* Share_Entry_Point (R1.1-R1.5). A themed share control that   */}
        {/* opens the Share_Composer pre-populated with an               */}
        {/* Experience_Share for this Experience. It is disabled while   */}
        {/* the Experience detail, the viewer's Rating, or the viewer's  */}
        {/* Note is still loading (R1.2). On activation it projects the   */}
        {/* loaded detail plus the viewer's Rating (whole 1–10 when       */}
        {/* present, R1.4) and Note (≤2000 chars when present, R1.5) into */}
        {/* discriminated `experience` composer params and navigates      */}
        {/* cross-navigator to the RootStack `ShareComposer` modal        */}
        {/* (R1.3).                                                       */}
        {/* ------------------------------------------------------------ */}
        <PrimaryButton
          label="Share"
          icon="share-social"
          testID="experience-share-button"
          accessibilityLabel={`Share ${experience.name}`}
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
          style={styles.shareButton}
        />

        {/* ------------------------------------------------------------ */}
        {/* Location_Group + Get_Directions_Action (R1.2, R4.2-R4.6,     */}
        {/* R7.1). Promoted directly beneath the header/hero region. The */}
        {/* Location Tag_Group renders as a labelled card of pills; the  */}
        {/* Get directions action is rendered within this area only when */}
        {/* the stored coordinates are valid (R4.2/R4.3) and opens the OS */}
        {/* maps app on activation (R4.4), surfacing a non-blocking       */}
        {/* inline error on failure while leaving the rest of the screen  */}
        {/* intact (R4.5). Omitted entirely when there is neither a        */}
        {/* Location group nor valid coordinates (R7.5).                   */}
        {/* ------------------------------------------------------------ */}
        <LocationGroupSection
          group={locationGroup}
          experienceName={experience.name}
          latitude={experience.latitude}
          longitude={experience.longitude}
        />

        {/* ------------------------------------------------------------ */}
        {/* Your visit (R6, R7.1, R7.2). The consolidated completion →   */}
        {/* rating → note card, promoted above the Live section and the  */}
        {/* About_Section. It owns its own per-control loading/error/     */}
        {/* empty rendering and the `onMutated` query invalidations       */}
        {/* verbatim (R6.2-R6.4).                                         */}
        {/* ------------------------------------------------------------ */}
        <YourVisitCard
          experienceId={experienceId}
          completionQuery={completionQ}
          ratingQuery={ratingQ}
          noteQuery={noteQ}
        />

        {/* ------------------------------------------------------------ */}
        {/* Live operational section (R7.1, R7.3, R8.3: at most one, by  */}
        {/* category). Ride/Character_Meet → wait/status, Show/Parade →  */}
        {/* showtimes, Restaurant → dining, Other → nothing. A live      */}
        {/* failure renders only the unavailable indicator (R8.4) while  */}
        {/* the static fields above remain visible; a stale success      */}
        {/* renders the out-of-date indicator + Retrieved_At, both owned  */}
        {/* by the section components. Placed above the About_Section     */}
        {/* (R7.3).                                                       */}
        {/* ------------------------------------------------------------ */}
        <LiveOperationalSection
          category={experience.category}
          query={liveQ}
        />

        {/* ------------------------------------------------------------ */}
        {/* Wait Insights (Task 6) - "When to ride"                      */}
        {/* Rendered only for attractions.                               */}
        {/* ------------------------------------------------------------ */}
        {experience.category === 'Ride' && (
          <WaitInsightsSection experienceId={experienceId} />
        )}

        {/* ------------------------------------------------------------ */}
        {/* Menu_Summary_Card (R7.4, R8.7). Rendered only for a          */}
        {/* Restaurant_Experience, positioned between the Live section    */}
        {/* and the About_Section. A pressable summary of the available   */}
        {/* menus that opens the Menu_Screen; nothing for a               */}
        {/* non-restaurant. The query flags are forwarded so the card     */}
        {/* owns its own loading/error rendering.                         */}
        {/* ------------------------------------------------------------ */}
        <MenuSummaryCard
          category={experience.category}
          menus={experience.menus}
          isLoading={experienceQ.isLoading}
          isError={experienceQ.isError}
          experienceId={experienceId}
          navigation={navigation}
        />

        {/* ------------------------------------------------------------ */}
        {/* About (R5, R7.1). The collapsible description: clamped to 4  */}
        {/* lines with a "Read more" / "Read less" toggle when it         */}
        {/* overflows, and the "No description available." empty state    */}
        {/* when absent/empty/whitespace-only (R5.8).                     */}
        {/* ------------------------------------------------------------ */}
        <AboutSection description={experience.description} />

        {/* ------------------------------------------------------------ */}
        {/* Why visit (R8.10, R8.11). Renders the Why_This bullets as    */}
        {/* flavor text when the Experience carries one or more; omitted  */}
        {/* entirely when the Why_This value is absent or every bullet    */}
        {/* merely duplicates the About description.                      */}
        {/* ------------------------------------------------------------ */}
        <WhyThisSection
          whyThis={experience.whyThis}
          description={experience.description}
        />

        {/* ------------------------------------------------------------ */}
        {/* Community Rating (R8.5, R8.6). Server enforces the           */}
        {/* `count >= 3` threshold; on the wire, `value === null` either */}
        {/* means "below threshold" or "no aggregate row yet" — both     */}
        {/* render as the same empty state.                              */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>Community Rating</SectionLabel>
          <AggregateContent query={aggregateQ} />
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Remaining Tag_Groups (R1.7, R1.8, R7.1): Good to know,       */}
        {/* Accessibility, Good for — rendered last, each as a labelled   */}
        {/* card of relabelled, de-duplicated pills, in the fixed order   */}
        {/* `buildTagGroups` emits, omitting any group with no            */}
        {/* renderable tags (R7.5).                                       */}
        {/* ------------------------------------------------------------ */}
        {remainingGroups.map((group) => (
          <TagGroupCard key={group.id} group={group} />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Hero image
// ---------------------------------------------------------------------------

/**
 * Full-width hero image for the detail view. Shows the sourced photo when
 * present; otherwise a category-tinted placeholder with the category glyph so
 * the layout is consistent whether or not an image exists. Disney imagery
 * needs no attribution caption (R14.8).
 */
function ExperienceHero({
  imageUrl,
  category,
}: {
  readonly imageUrl: string | null;
  readonly category: ExperienceCategory;
}): JSX.Element {
  const [failed, setFailed] = React.useState(false);
  const visual = theme.categoryVisual[category];
  const hasImage = imageUrl != null && imageUrl.length > 0 && !failed;

  if (!hasImage) {
    return (
      <View
        style={[styles.hero, styles.heroPlaceholder, { backgroundColor: visual.tint }]}
        testID="experience-hero-placeholder"
      >
        <Ionicons
          name={visual.glyph as keyof typeof Ionicons.glyphMap}
          size={48}
          color={theme.color.textOnPrimary}
        />
      </View>
    );
  }

  return (
    <View>
      <Image
        source={{ uri: imageUrl as string }}
        style={styles.hero}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        testID="experience-hero-image"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-section content
// ---------------------------------------------------------------------------

interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

function AggregateContent({
  query,
}: {
  readonly query: QueryLike<AggregateRatingDTO>;
}): JSX.Element {
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading community rating"
        color={theme.color.primary}
      />
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <Text style={styles.errorText}>Could not load community rating.</Text>
    );
  }
  // Project the aggregate into its display shape via the pure formatter
  // (R8.5, R8.6). The renderer stays a thin mapping over that result.
  const display = formatCommunityAggregate(query.data);
  // R10.6/R8.5: when `value` is null (count < 3, or no row yet) show the
  // empty state without leaking the underlying count.
  if (display.kind === 'empty') {
    return (
      <Text style={styles.empty} testID="aggregate-empty">
        Not enough ratings yet
      </Text>
    );
  }
  // R10.5/R8.6: render the published mean to one decimal alongside the
  // contributing rating count.
  return (
    <View style={styles.aggregateBlock}>
      <View style={styles.aggregateValueRow}>
        <Ionicons name="star" size={22} color={theme.color.accent} />
        <Text style={styles.aggregateValue} testID="aggregate-value">
          {display.mean} / 10
        </Text>
      </View>
      <Text style={styles.aggregateMeta} testID="aggregate-count">
        ({display.count} {display.count === 1 ? 'rating' : 'ratings'})
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Location group + Get directions
// ---------------------------------------------------------------------------

/**
 * Map the running OS to the `DirectionsPlatform` `directionsUrl` builds for.
 * Anything that is not iOS or Android (web, desktop) falls back to the
 * cross-platform web maps URL.
 */
function mapsPlatform(): DirectionsPlatform {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return 'web';
}

/**
 * Location_Group card plus the Get_Directions_Action (R1.2, R4.2-R4.6).
 *
 * Renders the Location Tag_Group's relabelled, de-duplicated tags as a wrapping
 * row of pills under a "Location" label. When the Experience carries valid
 * stored coordinates (R4.2 — latitude in [-90, 90] and longitude in [-180,
 * 180]) it also renders the Get_Directions_Action within this Location area;
 * the action is omitted entirely when the coordinates are absent or out of
 * range (R4.3).
 *
 * Activating the action opens the OS maps app at the stored coordinates via
 * `Linking.openURL(directionsUrl(...))` (R4.4). The call is wrapped in a
 * `try/catch` (after a `Linking.canOpenURL` check): if the maps app cannot be
 * opened the section sets a local error flag that renders an inline,
 * non-blocking error indication (matching the existing danger-text pattern)
 * while every other section of the screen stays intact (R4.5). The action
 * always exposes a non-empty accessibility label describing the Experience it
 * routes to (R4.6).
 *
 * When the coordinates are valid it additionally renders the Static_Map_Preview
 * (R10.1-R10.8): a tappable `<Image>` (wrapped in a `Pressable`) sourced from
 * `staticMapUrl(latitude, longitude)`, gated by the SAME `hasValidCoordinates`
 * check as Get directions. Tapping the preview opens the OS maps app via the
 * same `handleGetDirections` path (R10.5/R10.6). If the image fails to load, a
 * local `mapImageFailed` flag hides ONLY the image while the rest of the
 * Location content — including the Get directions button — keeps rendering
 * (R10.7). The preview carries a non-empty accessibility label (R10.8).
 *
 * The whole section is omitted when there is neither a Location Tag_Group to
 * show nor valid coordinates for a Get directions action.
 */
function LocationGroupSection({
  group,
  experienceName,
  latitude,
  longitude,
}: {
  readonly group: TagGroup | undefined;
  readonly experienceName: string;
  readonly latitude?: number | null | undefined;
  readonly longitude?: number | null | undefined;
}): JSX.Element | null {
  const [failed, setFailed] = React.useState(false);
  // R10.7: when the static map image fails to load, hide ONLY the image while
  // continuing to render the rest of the Location group content (including the
  // Get_Directions_Action).
  const [mapImageFailed, setMapImageFailed] = React.useState(false);
  const canGetDirections = hasValidCoordinates(latitude, longitude);

  // Nothing to render: no Location tags and no valid coordinates.
  if (group === undefined && !canGetDirections) {
    return null;
  }

  const handleGetDirections = async (): Promise<void> => {
    // `canGetDirections` already gates the coordinate range, so a truthy value
    // here means both are finite and in range (R4.2).
    const url = directionsUrl(
      latitude as number,
      longitude as number,
      mapsPlatform(),
    );
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        // R4.5: the OS reports it cannot open the maps URL.
        setFailed(true);
        return;
      }
      await Linking.openURL(url);
      // Clear any prior failure on a successful open.
      setFailed(false);
    } catch {
      // R4.5: opening the maps app rejected — surface the inline error and
      // preserve all other screen state.
      setFailed(true);
    }
  };

  return (
    <Card style={styles.section} testID="experience-location-group">
      <SectionLabel>{group?.label ?? 'Location'}</SectionLabel>

      {group !== undefined ? (
        <View style={styles.badgeRow}>
          {group.tags.map((tag, index) => (
            <Badge
              key={`${tag.kind}-${index}`}
              label={tag.label}
              color={theme.color.primary}
              accessibilityLabel={tag.accessibilityLabel}
              testID={`experience-info-tag-${tag.kind}`}
            />
          ))}
        </View>
      ) : null}

      {/* Static_Map_Preview (R10.1-R10.8). Gated by the SAME coordinate-validity
          check as the Get_Directions_Action (R10.1/R10.2). Tapping the preview
          opens the OS maps app via the same `handleGetDirections` path as Get
          directions (R10.5/R10.6). If the image fails to load, `mapImageFailed`
          hides only the image while the rest of the Location content — including
          the Get directions button — keeps rendering (R10.7). */}
      {canGetDirections && !mapImageFailed ? (
        <Pressable
          onPress={() => {
            void handleGetDirections();
          }}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Map preview of ${experienceName}. Tap for directions.`}
          testID="experience-static-map"
        >
          {/* The ArcGIS export image has no built-in marker, so overlay a
              centered pin. The coordinate sits at the exact bbox center, so a
              pin centered over the image lands on the Experience location. The
              pin is decorative for a11y — the Pressable carries the label. */}
          <View style={styles.mapPreviewWrap}>
            <Image
              source={{
                uri: staticMapUrl(latitude as number, longitude as number),
              }}
              style={styles.mapPreview}
              resizeMode="cover"
              onError={() => setMapImageFailed(true)}
              accessibilityIgnoresInvertColors
            />
            <Ionicons
              name="location"
              size={32}
              color={theme.color.accent}
              style={styles.mapPin}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
        </Pressable>
      ) : null}

      {canGetDirections ? (
        <SecondaryButton
          label="Get directions"
          icon="navigate"
          onPress={() => {
            void handleGetDirections();
          }}
          accessibilityLabel={`Get directions to ${experienceName}`}
          testID="experience-get-directions"
        />
      ) : null}

      {failed ? (
        <Text style={styles.errorText} testID="experience-directions-error">
          Couldn&apos;t open the maps app. Please try again.
        </Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Remaining Tag_Groups (Good to know / Accessibility / Good for)
// ---------------------------------------------------------------------------

/**
 * Render one non-Location Tag_Group as a labelled `Card` of pills (R1.7, R7.1).
 * Used for the Good_To_Know_Group, Accessibility_Group, and Good_For_Group,
 * which the screen places last in the fixed order `buildTagGroups` emits. The
 * group's relabelled, de-duplicated tags each render as a `Badge` carrying its
 * `accessibilityLabel` (R2.4, R2.5). `buildTagGroups` never emits an empty
 * group, so this card always has at least one pill to show (R7.5).
 */
function TagGroupCard({ group }: { readonly group: TagGroup }): JSX.Element {
  return (
    <Card style={styles.section} testID={`experience-tag-group-${group.id}`}>
      <SectionLabel>{group.label}</SectionLabel>
      <View style={styles.badgeRow}>
        {group.tags.map((tag, index) => (
          <Badge
            key={`${tag.kind}-${index}`}
            label={tag.label}
            color={theme.color.primary}
            accessibilityLabel={tag.accessibilityLabel}
            testID={`experience-info-tag-${tag.kind}`}
          />
        ))}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Why visit (Why_This)
// ---------------------------------------------------------------------------

/**
 * Normalize marketing copy for duplicate comparison: trim, collapse internal
 * whitespace runs to a single space, and lowercase. Used to detect when a
 * Why_This bullet merely restates the About description regardless of casing
 * or incidental whitespace differences. An absent value normalizes to `''`.
 */
function normalizeCopy(value?: string | null): string {
  return (value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * "Why visit" section (R11.4-R11.6). Renders the Why_This `bullets` as flavor
 * text when the Experience carries one or more (R11.4). Returns `null` — i.e.
 * omits the section entirely — when the Why_This value is absent/null or its
 * `bullets` list is empty (R11.5), so the screen never shows an empty "Why
 * visit" card. The `SectionLabel` header provides the screen-reader accessible
 * label for the section (R11.6); each bullet is a plain `Text` line.
 *
 * Bullets that merely restate the About `description` are filtered out so the
 * same copy is never shown in both sections; when that leaves no distinct
 * bullets the section is omitted just like the empty case above.
 */
function WhyThisSection({
  whyThis,
  description,
}: {
  readonly whyThis?: WhyThisDTO | null | undefined;
  readonly description?: string | undefined;
}): JSX.Element | null {
  const normalizedDescription = normalizeCopy(description);
  const bullets = (whyThis?.bullets ?? []).filter(
    (bullet) => normalizeCopy(bullet) !== normalizedDescription,
  );
  // R11.5: omit the section entirely when there is nothing distinct to show.
  if (bullets.length === 0) {
    return null;
  }
  return (
    <Card style={styles.section} testID="experience-why-this">
      <SectionLabel>Why visit</SectionLabel>
      {bullets.map((bullet, index) => (
        <Text key={`why-this-${index}`} style={styles.bodyText}>
          {bullet}
        </Text>
      ))}
    </Card>
  );
}

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

/**
 * Render at most one live operational section, chosen solely by the
 * Experience's category via `liveSectionFor` (R7.1–R7.5):
 *   - `Ride` / `Character_Meet` → wait/status section,
 *   - `Show` / `Parade`         → showtimes section,
 *   - `Restaurant`              → dining section,
 *   - `Other`                   → no live section.
 *
 * The read is independent of the static catalog detail, so a live failure
 * degrades to the unavailable indicator (R3.2) without affecting the static
 * fields. On a `stale: true` success the section component renders the
 * out-of-date indicator together with the Retrieved_At time (R3.5).
 */
function LiveOperationalSection({
  category,
  query,
}: {
  readonly category: ExperienceCategory;
  readonly query: QueryLike<LiveDetailResponseDTO>;
}): JSX.Element | null {
  const detail = query.data?.liveDetail;
  // No loaded Live_Detail means "nothing known", which gates identically to the
  // category-only behavior; the shape is always passed so the compiler can catch
  // a call site that forgets it (see `NO_LIVE_SHAPE`).
  const liveShape: LiveShape = detail
    ? {
        hasStandbyWait:
          typeof detail.waitMinutes === 'number' && !Number.isNaN(detail.waitMinutes),
        hasShowtimes:
          Array.isArray(detail.showtimes) && detail.showtimes.length > 0,
      }
    : NO_LIVE_SHAPE;

  const section = liveSectionFor(category, liveShape);

  // R7.1 / R5.2 / R5.5: `Other` (and any non-live category) shows no live section at all.
  if (section === 'none') {
    return null;
  }

  if (query.isLoading) {
    return (
      <Card style={styles.section}>
        <ActivityIndicator
          accessibilityLabel="Loading live information"
          color={theme.color.primary}
        />
      </Card>
    );
  }

  // R3.2: a failed live retrieval (the orchestrator returns a 503
  // `live_unavailable` when no cached Live_Detail exists) shows only the
  // unavailable indicator; the static fields above remain visible (R3.3).
  if (query.isError || query.data === undefined) {
    return <LiveUnavailableIndicator />;
  }

  const { liveDetail, retrievedAt, stale } = query.data;
  // Lift `upstreamLastUpdated` out of the detail so the section can label it
  // distinctly from Retrieved_At (R4.13, R5.7, R6.8).
  const sectionProps = {
    liveDetail,
    retrievedAt,
    stale,
    ...(liveDetail.upstreamLastUpdated !== undefined
      ? { upstreamLastUpdated: liveDetail.upstreamLastUpdated }
      : {}),
  };

  switch (section) {
    case 'wait_status': // R7.2
      return <RideLiveSection {...sectionProps} />;
    case 'showtimes': // R7.3
      return <ShowtimesSection {...sectionProps} />;
    case 'dining': // R7.4
      return <DiningSection {...sectionProps} />;
    default: {
      // Exhaustiveness guard: a new `LiveSection` member must be handled here.
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
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
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    flexWrap: 'wrap',
  },
  shareButton: {
    marginTop: theme.spacing.xs,
  },
  hero: {
    width: '100%',
    height: 200,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceAlt,
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
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
});
