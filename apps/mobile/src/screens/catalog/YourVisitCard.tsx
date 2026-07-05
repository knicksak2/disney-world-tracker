// Feature: experience-detail-redesign, Task 4.1 — Consolidated "Your visit" card
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
//
// Behavior summary:
//   - Renders the completion, rating, and note controls inside a single
//     `Card` under a "Your visit" `SectionLabel`, in the fixed vertical
//     order completion -> rating -> note (R6.1).
//   - Reuses the EXACT existing `CompletionControls` / `RatingControl` /
//     `NoteControl` components, so the mark/unmark, set/replace/remove, and
//     add/edit/delete behaviors — plus their per-control busy gating, inline
//     error copy, and last-value retention — are preserved verbatim
//     (R6.2, R6.3, R6.4, R6.9, R6.10).
//   - Each control renders its own loading / error / empty state through the
//     same `QueryLike` branch structure used previously on the detail screen,
//     with `isError` taking precedence over the loading indicator and each
//     control's state independent of the other two (R6.5, R6.6, R6.7).
//   - Preserves the existing accessibility labels for each control (R6.8):
//     the loading spinners keep their "Loading completion" / "Loading rating"
//     / "Loading note" labels, and the reused controls keep their own.
//   - Owns the `onMutated` query invalidations verbatim so wiring stays
//     self-contained:
//       * completion -> ['experience-completion', id] + ['me-stats']  (R6.2)
//       * rating     -> ['experience-rating', id] + ['experience-aggregate', id] (R6.3)
//       * note       -> ['experience-note', id]                        (R6.4)
//
// This component is a pure re-composition of the three controls that
// previously lived in three separate `Card`s on `ExperienceDetailScreen`.
// The controls, their props, and their invalidation keys are unchanged; only
// their placement (one shared card) differs.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import type { CompletionDTO, NoteDTO, RatingDTO } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Card, SectionLabel } from '../../theme/components';
import CompletionControls from './CompletionControls';
import RatingControl from './RatingControl';
import NoteControl from './NoteControl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The narrow slice of a react-query `UseQueryResult` each control section
 * consumes. Mirrors the `QueryLike` shape used elsewhere on the detail screen
 * so callers can hand the raw query results straight through.
 */
interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

export interface YourVisitCardProps {
  /** UUID of the Experience the three controls act on. */
  readonly experienceId: string;
  /** The viewer's own Completion query result. */
  readonly completionQuery: QueryLike<CompletionDTO | null>;
  /** The viewer's own Rating query result. */
  readonly ratingQuery: QueryLike<RatingDTO | null>;
  /** The viewer's own Note query result. */
  readonly noteQuery: QueryLike<NoteDTO | null>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function YourVisitCard({
  experienceId,
  completionQuery,
  ratingQuery,
  noteQuery,
}: YourVisitCardProps): JSX.Element {
  const queryClient = useQueryClient();

  return (
    <Card style={styles.section} testID="your-visit-card">
      <SectionLabel>Your visit</SectionLabel>

      {/* Fixed order (R6.1): completion first. */}
      <CompletionSection
        experienceId={experienceId}
        query={completionQuery}
        onMutated={() => {
          // Invalidate every query that reflects Completion state for this
          // Experience — this section's own read...
          void queryClient.invalidateQueries({
            queryKey: ['experience-completion', experienceId],
          });
          // ...and the Stats screen's roll-up (`['me-stats']`), which counts
          // completions and would otherwise show stale totals until its
          // staleTime lapses. The prefix also catches the friend/self
          // summary variants.
          void queryClient.invalidateQueries({
            queryKey: ['me-stats'],
          });
        }}
      />

      {/* Then rating. */}
      <RatingSection
        experienceId={experienceId}
        query={ratingQuery}
        onMutated={() => {
          // Refresh both the viewer's own rating row and the community
          // aggregate — the latter changes whenever a rating is set,
          // replaced, or removed.
          void queryClient.invalidateQueries({
            queryKey: ['experience-rating', experienceId],
          });
          void queryClient.invalidateQueries({
            queryKey: ['experience-aggregate', experienceId],
          });
        }}
      />

      {/* Then note. */}
      <NoteSection
        experienceId={experienceId}
        query={noteQuery}
        onMutated={() => {
          // Invalidate the cached Note read so the section re-renders with the
          // freshest DTO. Stats and Share surfaces don't read off the Note
          // query directly, so a single invalidate here is sufficient.
          void queryClient.invalidateQueries({
            queryKey: ['experience-note', experienceId],
          });
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-control sections
// ---------------------------------------------------------------------------
//
// Each section owns its own loading / error / empty rendering, independent of
// the other two (R6.5, R6.6, R6.7). `isError` is checked before `isLoading`
// so the error text takes precedence over the loading indicator (R6.6). The
// reused control components own the populated render, busy gating (R6.9), and
// last-value retention on mutation failure (R6.10).

function CompletionSection({
  experienceId,
  query,
  onMutated,
}: {
  readonly experienceId: string;
  readonly query: QueryLike<CompletionDTO | null>;
  readonly onMutated: () => void;
}): JSX.Element {
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load completion.</Text>;
  }
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading completion"
        color={theme.color.primary}
      />
    );
  }
  // `data` is `undefined` until the first fetch resolves; treat it as "no
  // completion yet" so the empty-state mark button is reachable immediately
  // on the first render after the query settles (R6.7).
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
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load rating.</Text>;
  }
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading rating"
        color={theme.color.primary}
      />
    );
  }
  // `data` is `undefined` until the first fetch resolves; treat it as "no
  // Rating yet" so the empty-state Rate affordance is reachable immediately
  // on the first render after the query settles (R6.7). The control maps
  // `rating === null` to the empty state and any non-null value to the
  // populated render.
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
  if (query.isError) {
    return <Text style={styles.errorText}>Could not load note.</Text>;
  }
  if (query.isLoading) {
    return (
      <ActivityIndicator
        accessibilityLabel="Loading note"
        color={theme.color.primary}
      />
    );
  }
  // `data` is `undefined` until the first fetch resolves; treat it as "no
  // Note yet" so the empty-state Add affordance is reachable immediately on
  // the first render after the query settles (R6.7). The control maps
  // `note === null` to the empty state and any non-null value to the
  // populated render.
  const note = query.data ?? null;
  return (
    <NoteControl
      experienceId={experienceId}
      note={note}
      onMutated={onMutated}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    gap: theme.spacing.md,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.color.danger,
  },
});
