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
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import type {
  AggregateRatingDTO,
  CompletionDTO,
  ErrorCode,
  ExperienceCategory,
  LiveDetailResponseDTO,
  NoteDTO,
  Park,
  RatingDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { CatalogStackParamList } from '../../navigation/CatalogStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SectionLabel,
} from '../../theme/components';
import CompletionControls from './CompletionControls';
import NoteControl from './NoteControl';
import RatingControl from './RatingControl';
import { liveSectionFor } from './gating';
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
  readonly imageAttribution: string | null;
}

type ExperienceDetailRouteProp = RouteProp<
  CatalogStackParamList,
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
  const { experienceId } = route.params;
  const encodedId = encodeURIComponent(experienceId);
  const queryClient = useQueryClient();

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
        <GradientHeader title="Experience" icon="map" compact />
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
      />

      <ScrollView
        contentContainerStyle={styles.container}
        testID="experience-detail"
      >
        {/* Hero image (sourced photo or category placeholder). */}
        <ExperienceHero
          imageUrl={experience.imageUrl}
          attribution={experience.imageAttribution}
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
        {/* About (R1.22). Server is responsible for HTML/script         */}
        {/* stripping at write time; the App renders it as plain Text.   */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>About</SectionLabel>
          {experience.description.length > 0 ? (
            <Text style={styles.bodyText}>{experience.description}</Text>
          ) : (
            <Text style={styles.empty}>No description available.</Text>
          )}
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Live operational section (R7.5: at most one, by category).   */}
        {/* Ride/Character_Meet → wait/status, Show/Parade → showtimes,  */}
        {/* Restaurant → dining, Other → nothing (R7.1-R7.4). A live     */}
        {/* failure renders only the unavailable indicator (R3.2) while  */}
        {/* the static fields above remain visible (R3.3); a stale       */}
        {/* success renders the out-of-date indicator + Retrieved_At     */}
        {/* (R3.5), both owned by the section components.                */}
        {/* ------------------------------------------------------------ */}
        <LiveOperationalSection
          category={experience.category}
          query={liveQ}
        />

        {/* ------------------------------------------------------------ */}
        {/* Your Completion (R2.4).                                      */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>Your Completion</SectionLabel>
          <CompletionSection
            experienceId={experienceId}
            query={completionQ}
            onMutated={() => {
              // Invalidate every query that reflects Completion state for
              // this Experience. The Completion query drives this
              // section's render...
              void queryClient.invalidateQueries({
                queryKey: ['experience-completion', experienceId],
              });
              // ...and the Stats screen's roll-up (`GET /me/stats`,
              // queryKey ['me-stats']) counts completions, so it must be
              // invalidated here too. Without this, marking/unmarking a
              // Completion leaves the cached stats untouched and the
              // Stats screen keeps showing the pre-mutation totals until
              // its staleTime lapses — i.e. "I completed a ride but my
              // stats still say zero". `['me-stats']` as a prefix also
              // catches the friend/self summary variants.
              void queryClient.invalidateQueries({
                queryKey: ['me-stats'],
              });
            }}
          />
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Your Rating (R4.1, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8).      */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>Your Rating</SectionLabel>
          <RatingSection
            experienceId={experienceId}
            query={ratingQ}
            onMutated={() => {
              // Refresh both the User's own rating row and the community
              // aggregate (R10.5, R10.6) — the latter changes whenever a
              // rating is set, replaced, or removed.
              void queryClient.invalidateQueries({
                queryKey: ['experience-rating', experienceId],
              });
              void queryClient.invalidateQueries({
                queryKey: ['experience-aggregate', experienceId],
              });
            }}
          />
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Your Note (R5.3-R5.9).                                       */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>Your Note</SectionLabel>
          <NoteSection
            experienceId={experienceId}
            query={noteQ}
            onMutated={() => {
              // Invalidate the cached Note read for this Experience so
              // the section re-renders with the freshest DTO (R5.8 /
              // R5.9 render parity). Stats and Share surfaces don't read
              // off the Note query directly, so a single invalidate
              // here is sufficient.
              void queryClient.invalidateQueries({
                queryKey: ['experience-note', experienceId],
              });
            }}
          />
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Community Rating (R10.5, R10.6). Server enforces the         */}
        {/* `count >= 3` threshold; on the wire, `value === null` either */}
        {/* means "below threshold" or "no aggregate row yet" — both     */}
        {/* render as the same empty state.                              */}
        {/* ------------------------------------------------------------ */}
        <Card style={styles.section}>
          <SectionLabel>Community Rating</SectionLabel>
          <AggregateContent query={aggregateQ} />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Hero image
// ---------------------------------------------------------------------------

/**
 * Full-width hero image for the detail view. Shows the sourced photo when
 * present (with its license attribution caption beneath, as required by the
 * image's terms); otherwise a category-tinted placeholder with the category
 * glyph so the layout is consistent whether or not an image exists.
 */
function ExperienceHero({
  imageUrl,
  attribution,
  category,
}: {
  readonly imageUrl: string | null;
  readonly attribution: string | null;
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
      {attribution != null && attribution.length > 0 ? (
        <Text style={styles.heroAttribution} numberOfLines={2}>
          {attribution}
        </Text>
      ) : null}
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

function CompletionSection({
  experienceId,
  query,
  onMutated,
}: {
  readonly experienceId: string;
  readonly query: QueryLike<CompletionDTO | null>;
  readonly onMutated: () => void;
}): JSX.Element {
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading completion"
        color={theme.color.primary}
      />
    );
  }
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load completion.</Text>;
  }
  // `data` is `undefined` until the first fetch resolves; treat it as
  // "no completion yet" so the empty-state mark button is reachable
  // immediately on the first render after the query settles.
  const completion = query.data ?? null;
  return (
    <CompletionControls
      experienceId={experienceId}
      completion={completion}
      onMutated={onMutated}
    />
  );
}

function RatingSection({
  experienceId,
  query,
  onMutated,
}: {
  readonly experienceId: string;
  readonly query: QueryLike<RatingDTO | null>;
  readonly onMutated: () => void;
}): JSX.Element {
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading rating"
        color={theme.color.primary}
      />
    );
  }
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load rating.</Text>;
  }
  // `data` is `undefined` until the first fetch resolves; treat it as
  // "no Rating yet" so the empty-state Rate affordance is reachable
  // immediately on the first render after the query settles. The
  // control itself maps `rating === null` to the R4.6 empty state
  // and any non-null value to the R4.5 populated render.
  const rating = query.data ?? null;
  return (
    <RatingControl
      experienceId={experienceId}
      rating={rating}
      onMutated={onMutated}
    />
  );
}

function NoteSection({
  experienceId,
  query,
  onMutated,
}: {
  readonly experienceId: string;
  readonly query: QueryLike<NoteDTO | null>;
  readonly onMutated: () => void;
}): JSX.Element {
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading note"
        color={theme.color.primary}
      />
    );
  }
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load note.</Text>;
  }
  // `data` is `undefined` until the first fetch resolves; treat it as
  // "no Note yet" so the empty-state Add affordance is reachable
  // immediately on the first render after the query settles. The
  // control itself maps `note === null` to the R5.9 empty state and
  // any non-null value to the R5.8 populated render.
  const note = query.data ?? null;
  return (
    <NoteControl
      experienceId={experienceId}
      note={note}
      onMutated={onMutated}
    />
  );
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
  const aggregate = query.data;
  // R10.6: when `value` is null (count < 3, or no row yet) show the
  // empty state without leaking the underlying count.
  if (aggregate.value === null) {
    return (
      <Text style={styles.empty} testID="aggregate-empty">
        Not enough ratings yet
      </Text>
    );
  }
  // R10.5: render the published mean to one decimal alongside the
  // contributing rating count.
  return (
    <View style={styles.aggregateBlock}>
      <View style={styles.aggregateValueRow}>
        <Ionicons name="star" size={22} color={theme.color.accent} />
        <Text style={styles.aggregateValue} testID="aggregate-value">
          {aggregate.value.toFixed(1)} / 10
        </Text>
      </View>
      <Text style={styles.aggregateMeta} testID="aggregate-count">
        ({aggregate.count} {aggregate.count === 1 ? 'rating' : 'ratings'})
      </Text>
    </View>
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
  const section = liveSectionFor(category);

  // R7.1: `Other` (and any non-live category) shows no live section at all.
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
  heroAttribution: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
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
