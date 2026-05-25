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
//   - This screen is read-only display for task 16.3; the actual
//     mark / edit / save controls land in tasks 17.1, 17.2, and 17.3.
//     Each "Your …" section therefore renders a disabled "Edit"
//     placeholder button at the spot where the real control will mount,
//     so the layout is final and the next tasks only swap component
//     contents.

import React from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import type {
  AggregateRatingDTO,
  CompletionDTO,
  ErrorCode,
  ExperienceCategory,
  NoteDTO,
  Park,
  RatingDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { CatalogStackParamList } from '../../navigation/CatalogStack';
import CompletionControls from './CompletionControls';
import NoteControl from './NoteControl';
import RatingControl from './RatingControl';

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
    ],
  });

  const experienceQ = queries[0];
  const completionQ = queries[1];
  const ratingQ = queries[2];
  const noteQ = queries[3];
  const aggregateQ = queries[4];

  // Block the whole screen on the catalog detail load — the section
  // headers depend on the Experience name and the screen has nothing
  // useful to show without it. The four secondary fetches each render
  // their own loading/empty/populated state inline so the page isn't
  // gated on the slowest hop.
  if (experienceQ.isLoading) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  if (experienceQ.isError || experienceQ.data === undefined) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          We couldn&apos;t load this experience. Please try again later.
        </Text>
      </View>
    );
  }

  const experience = experienceQ.data;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="experience-detail"
    >
      {/* -------------------------------------------------------------- */}
      {/* Header: name + Park + category badges (R1.22)                  */}
      {/* -------------------------------------------------------------- */}
      <View style={styles.headerBlock}>
        <Text style={styles.name} accessibilityRole="header">
          {experience.name}
        </Text>
        <View style={styles.badgeRow}>
          <Badge label={experience.park} testID="experience-park-badge" />
          <Badge
            label={categoryLabel(experience.category)}
            testID="experience-category-badge"
          />
        </View>
      </View>

      {/* -------------------------------------------------------------- */}
      {/* Description (R1.22). Server is responsible for HTML/script    */}
      {/* stripping at write time (R1.7 sanitization step in the catalog */}
      {/* repo); the App renders it as plain Text.                       */}
      {/* -------------------------------------------------------------- */}
      <Section title="About">
        {experience.description.length > 0 ? (
          <Text style={styles.bodyText}>{experience.description}</Text>
        ) : (
          <Text style={styles.empty}>No description available.</Text>
        )}
      </Section>

      {/* -------------------------------------------------------------- */}
      {/* Your Completion (R2.4). Task 17.1 swaps the placeholder for    */}
      {/* the real mark / unmark / edit-date control                     */}
      {/* (`CompletionControls`). The control owns the mutations and     */}
      {/* invalidates the cached Completion query through `onMutated`    */}
      {/* so the section re-renders with the freshest DTO.               */}
      {/* -------------------------------------------------------------- */}
      <Section title="Your Completion">
        <CompletionSection
          experienceId={experienceId}
          query={completionQ}
          onMutated={() => {
            // Invalidate every query that reflects Completion state for
            // this Experience. The Completion query itself drives the
            // section render; the stats query (R3) and any future
            // friend-feed surfaces also read off the same store, so a
            // single invalidate keeps them in lockstep.
            void queryClient.invalidateQueries({
              queryKey: ['experience-completion', experienceId],
            });
          }}
        />
      </Section>

      {/* -------------------------------------------------------------- */}
      {/* Your Rating (R4.1, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8). Task   */}
      {/* 17.2 swaps the placeholder for the real RatingControl, which   */}
      {/* owns the 1..10 picker plus the set / replace / remove flows.   */}
      {/* The control invokes `onMutated` after every successful write   */}
      {/* so the rating + community-aggregate queries refetch.           */}
      {/* -------------------------------------------------------------- */}
      <Section title="Your Rating">
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
      </Section>

      {/* -------------------------------------------------------------- */}
      {/* Your Note (R5.3-R5.9). Task 17.3 swaps the placeholder for     */}
      {/* the real `NoteControl`, which handles add / edit / delete in   */}
      {/* place. The control owns its own buttons (Add / Edit / Delete   */}
      {/* / Save / Cancel) so the section header no longer carries the   */}
      {/* disabled "Edit" placeholder.                                   */}
      {/* -------------------------------------------------------------- */}
      <Section title="Your Note">
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
      </Section>

      {/* -------------------------------------------------------------- */}
      {/* Community Rating (R10.5, R10.6). Server enforces the           */}
      {/* `count >= 3` threshold; on the wire, `value === null` either   */}
      {/* means "below threshold" or "no aggregate row yet" — both       */}
      {/* render as the same empty state.                                */}
      {/* -------------------------------------------------------------- */}
      <Section title="Community Rating">
        <AggregateContent query={aggregateQ} />
      </Section>
    </ScrollView>
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
    return <ActivityIndicator accessibilityLabel="Loading completion" />;
  }
  if (query.isError) {
    return (
      <Text style={styles.errorText}>Could not load completion.</Text>
    );
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
    return <ActivityIndicator accessibilityLabel="Loading rating" />;
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
    return <ActivityIndicator accessibilityLabel="Loading note" />;
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
      <ActivityIndicator accessibilityLabel="Loading community rating" />
    );
  }
  if (query.isError || query.data === undefined) {
    return (
      <Text style={styles.errorText}>
        Could not load community rating.
      </Text>
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
      <Text style={styles.aggregateValue} testID="aggregate-value">
        {aggregate.value.toFixed(1)} / 10
      </Text>
      <Text style={styles.aggregateMeta} testID="aggregate-count">
        ({aggregate.count} {aggregate.count === 1 ? 'rating' : 'ratings'})
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Presentational primitives
// ---------------------------------------------------------------------------

interface BadgeProps {
  readonly label: string;
  readonly testID?: string;
}

function Badge({ label, testID }: BadgeProps): JSX.Element {
  return (
    <View style={styles.badge} testID={testID}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

interface SectionProps {
  readonly title: string;
  /**
   * When provided, renders a disabled placeholder button on the section
   * header. Tasks 17.1 / 17.2 / 17.3 will replace these with the real
   * controls; carrying the slot now keeps the layout stable across the
   * follow-up tasks.
   */
  readonly actionLabel?: string;
  readonly children: React.ReactNode;
}

function Section({
  title,
  actionLabel,
  children,
}: SectionProps): JSX.Element {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {actionLabel !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${title}`}
            // No-op; the real handler is wired in the corresponding 17.x
            // task. Disabled visually so the placeholder doesn't read
            // as an interactive control.
            onPress={noop}
            disabled
            style={styles.sectionAction}
          >
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function noop(): void {
  // Intentionally empty — placeholder for 17.x controls.
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    padding: 24,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  headerBlock: {
    gap: 8,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
  },
  section: {
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    opacity: 0.5,
  },
  sectionActionText: {
    color: '#6b7280',
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  ratingValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  aggregateBlock: {
    gap: 2,
  },
  aggregateValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  aggregateMeta: {
    fontSize: 12,
    color: '#6b7280',
  },
  errorText: {
    color: '#b91c1c',
  },
});
