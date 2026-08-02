// Feature: trips, Task 17.4 — Rode_With_Tag confirmation screen
//
// Validates: Requirements 11.4, 11.5, 18.3
//
// Behavior summary:
//   - This is the deep-link target reached when a Tagged_Member taps a
//     Rode_With_Tag push notification (R18.3). It receives the notification's
//     `{ rodeWithTagId, tripLogEntryId }` routing ids as route params and
//     presents controls to confirm or decline the tag.
//   - It reads the tag's deep-link target via `GET /me/rode-with-tags/:tagId`
//     (the rode-with analog of the invite deep-link read
//     `GET /me/trip-invites/:inviteId`) to learn the referenced Experience,
//     the tagging Member, the tag's current state, and — for the rating
//     add/update — the Tagged_Member's current canonical Rating for that
//     Experience (or `null` when they have none). The screen renders exactly
//     what that read hands it; the confirm-before-write invariant and all
//     authorization/state checks are enforced server-side (R11.1, R11.7,
//     R11.8).
//   - While the tag is `pending`, the screen offers:
//       • Confirm — posts `POST /me/rode-with-tags/:tagId/confirm` with an
//         optional canonical Rating (R11.2–R11.5).
//       • Decline — posts `POST /me/rode-with-tags/:tagId/decline`, which
//         writes nothing to the Tagged_Member's data (R11.6).
//     The rating input is a 1–10 selector pre-filled with the current
//     canonical Rating when one exists (R11.5) and left unset — an optional
//     add — when none exists (R11.4). Leaving it unset omits `rating` from the
//     confirm body so the existing canonical Rating (if any) is left unchanged.
//   - When the tag is no longer `pending` (already `confirmed` / `declined` /
//     `cancelled`), or the read fails, the screen shows an informational state
//     without confirm/decline controls; the server would reject a second
//     action with `trip_tag_state_invalid` anyway (R11.8). The deep-link tap
//     handler (task 17.8) owns the Trips_List fallback for a fully missing
//     target (R18.5); here we surface read failures gracefully in place.
//
// Styling follows the shared "Magical / Whimsical" theme, mirroring
// `TripDetailScreen` (compact gradient header with a back control, themed
// cards/buttons).
//
// NOTE ON THE READ CONTRACT: the API endpoint table in the design documents
// the confirm/decline POSTs but not a single-tag GET; the deep-link confirm
// view needs one to pre-fill the current canonical Rating (R11.5) and to know
// whether the target still exists (R18.5), exactly as the invite deep-link
// read does. This screen therefore consumes `GET /me/rode-with-tags/:tagId`
// with the response shape declared locally below; the API-side rode-with task
// should expose this read to match.

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  rodeWithConfirmSchema,
  type RodeWithTagState,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'RodeWithConfirm'>;

/**
 * Wire shape of `GET /me/rode-with-tags/:tagId` — the deep-link target for the
 * confirm view. Mirrors the invite deep-link read: it returns the tag
 * regardless of state so the screen can present confirm/decline controls when
 * `pending` and an informational state otherwise. `currentRating` is the
 * Tagged_Member's current canonical Rating for the referenced Experience,
 * joined live at read time, or `null` when they have none (R11.4, R11.5).
 */
interface RodeWithTagTargetResponse {
  readonly id: string;
  readonly tripId: string;
  readonly tripLogEntryId: string;
  readonly state: RodeWithTagState;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly taggingMemberDisplayName: string;
  /** Current canonical Rating (whole number 1–10) or `null` when unrated. */
  readonly currentRating: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for a single rode-with tag's deep-link target, keyed by tag id. */
export const rodeWithTagKeys = {
  target: (tagId: string) => ['trips', 'rode-with-tag', tagId] as const,
};

/** The selectable canonical Rating values, a whole number 1–10 (R11.4/R11.5). */
const RATING_VALUES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function RodeWithConfirmScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { rodeWithTagId } = route.params;
  const queryClient = useQueryClient();

  const tagQuery = useQuery<RodeWithTagTargetResponse, ApiError>({
    queryKey: rodeWithTagKeys.target(rodeWithTagId),
    queryFn: () =>
      apiRequest<RodeWithTagTargetResponse>(
        'GET',
        `/me/rode-with-tags/${rodeWithTagId}`,
      ),
  });

  // The chosen canonical Rating for a confirm, or `null` to leave it unset.
  // Initialized from the read's `currentRating` once (R11.5 pre-fill) via the
  // key on the inner content component, so a refetch does not clobber an edit.
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const tag = tagQuery.data;

  // Seed the rating selector from the current canonical Rating the first time
  // the target loads (R11.5). Done in render (guarded by `initialized`) rather
  // than an effect so the pre-fill is present on the first paint of the form.
  if (!initialized && tag !== undefined) {
    setSelectedRating(tag.currentRating);
    setInitialized(true);
  }

  const confirmMutation = useMutation<void, ApiError, number | null>({
    mutationFn: async (rating) => {
      // Validate the optional rating with the shared schema so the control
      // enforces the same whole-number 1–10 rule as the server (R11.9). An
      // unset rating omits the field entirely, leaving the canonical Rating
      // unchanged (R11.5).
      const body = rating === null ? {} : { rating };
      const parsed = rodeWithConfirmSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError({
          code: 'rating_out_of_range',
          message: 'rating_out_of_range',
          status: 400,
        });
      }
      await apiRequest<void>(
        'POST',
        `/me/rode-with-tags/${rodeWithTagId}/confirm`,
        parsed.data,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: rodeWithTagKeys.target(rodeWithTagId),
      });
      leaveAfterAction();
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  const declineMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiRequest<void>(
        'POST',
        `/me/rode-with-tags/${rodeWithTagId}/decline`,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: rodeWithTagKeys.target(rodeWithTagId),
      });
      leaveAfterAction();
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  const busy = confirmMutation.isPending || declineMutation.isPending;

  // After a confirm/decline completes, return to where the User came from. A
  // deep-link entry may have no back stack, so fall back to the Trips list.
  function leaveAfterAction(): void {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripsList');
  }

  const backToList = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripsList');
  };

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (tagQuery.isLoading && tag === undefined) {
    return (
      <ScreenContainer>
        <ConfirmHeader onBack={backToList} />
        <View style={styles.center} testID="rode-with-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Read error — the target could not be loaded
  // -------------------------------------------------------------------------

  if (tagQuery.isError && tag === undefined) {
    return (
      <ScreenContainer>
        <ConfirmHeader onBack={backToList} />
        <View style={styles.center} testID="rode-with-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this tag"
            body={readErrorMessage(tagQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tagQuery.refetch();
            }}
            testID="rode-with-retry"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const target = tag as RodeWithTagTargetResponse;
  const isPending = target.state === 'pending';

  // -------------------------------------------------------------------------
  // Already resolved — no confirm/decline controls (R11.8)
  // -------------------------------------------------------------------------

  if (!isPending) {
    return (
      <ScreenContainer>
        <ConfirmHeader onBack={backToList} />
        <View style={styles.center} testID="rode-with-resolved">
          <EmptyState
            icon="information-circle-outline"
            title="Nothing to confirm"
            body={resolvedMessage(target)}
          />
          <PrimaryButton
            label="Done"
            icon="checkmark-outline"
            onPress={backToList}
            testID="rode-with-done"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Pending — confirm / decline + rating add/update
  // -------------------------------------------------------------------------

  return (
    <ScreenContainer>
      <ConfirmHeader onBack={backToList} />
      <ScrollView
        contentContainerStyle={styles.content}
        testID="rode-with-confirm"
      >
        <Card style={styles.summaryCard} testID="rode-with-summary">
          <Text style={styles.experienceName}>{target.experienceName}</Text>
          <Text style={styles.prompt}>
            {`${target.taggingMemberDisplayName} tagged you as riding this together.`}
          </Text>
          <Text style={styles.helper}>
            Confirm to add it to your park record, or decline to leave your data
            unchanged.
          </Text>
        </Card>

        <RatingSelector
          currentRating={target.currentRating}
          selected={selectedRating}
          disabled={busy}
          onSelect={(value) => {
            setSelectedRating(value);
            if (actionError !== null) setActionError(null);
          }}
        />

        {actionError !== null ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            testID="rode-with-action-error"
          >
            {actionError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={confirmMutation.isPending ? 'Confirming\u2026' : 'Confirm'}
            icon="checkmark-circle-outline"
            onPress={() => {
              setActionError(null);
              confirmMutation.mutate(selectedRating);
            }}
            disabled={busy}
            testID="rode-with-confirm-submit"
            style={styles.actionBtn}
          />
          <SecondaryButton
            label="Decline"
            icon="close-circle-outline"
            tone="danger"
            onPress={() => {
              setActionError(null);
              declineMutation.mutate();
            }}
            disabled={busy}
            testID="rode-with-decline"
            style={styles.actionBtn}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Shared compact header for every state of the confirm screen. */
function ConfirmHeader({ onBack }: { readonly onBack: () => void }): JSX.Element {
  return (
    <GradientHeader
      title="Rode-with tag"
      subtitle="Confirm before it's added to your record."
      icon="people"
      compact
      onBack={onBack}
    />
  );
}

/**
 * The 1–10 canonical Rating selector. Pre-filled by the caller with the current
 * canonical Rating when one exists (R11.5); left unset for an optional add when
 * none exists (R11.4). Tapping the selected value again clears it back to
 * unset, which leaves the existing canonical Rating unchanged on confirm.
 */
function RatingSelector({
  currentRating,
  selected,
  disabled,
  onSelect,
}: {
  readonly currentRating: number | null;
  readonly selected: number | null;
  readonly disabled: boolean;
  readonly onSelect: (value: number | null) => void;
}): JSX.Element {
  const heading = useMemo(
    () => (currentRating === null ? 'Add a rating (optional)' : 'Update your rating'),
    [currentRating],
  );
  return (
    <Card style={styles.ratingCard} testID="rode-with-rating">
      <View style={styles.ratingHeaderRow}>
        <Text style={styles.ratingHeading}>{heading}</Text>
        {currentRating !== null ? (
          <Badge label={`Current ${currentRating}/10`} color={theme.color.primary} />
        ) : null}
      </View>
      <Text style={styles.helper}>
        {selected === null
          ? 'No rating selected — your rating stays as it is.'
          : `Selected ${selected}/10 — tap it again to clear.`}
      </Text>
      <View style={styles.ratingChips}>
        {RATING_VALUES.map((value) => (
          <Chip
            key={value}
            label={String(value)}
            active={selected === value}
            onPress={() => {
              if (disabled) return;
              onSelect(selected === value ? null : value);
            }}
            testID={`rode-with-rating-${value}`}
          />
        ))}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Copy for the informational state when the tag is no longer `pending`. */
function resolvedMessage(target: RodeWithTagTargetResponse): string {
  switch (target.state) {
    case 'confirmed':
      return `You've already confirmed riding ${target.experienceName}.`;
    case 'declined':
      return `You've already declined this tag for ${target.experienceName}.`;
    default:
      return 'This tag is no longer available to confirm.';
  }
}

/** Map a read error to user-facing copy (non-disclosure, R15.2). */
function readErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This tag is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map a confirm/decline error to user-facing copy. */
function actionErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'rating_out_of_range':
      return 'Please choose a rating from 1 to 10.';
    case 'trip_tag_state_invalid':
      // R11.8: the tag was already confirmed/declined elsewhere. Surface it in
      // place; a refetch will flip the screen to its resolved state.
      return 'This tag has already been handled.';
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This tag is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  summaryCard: {
    gap: theme.spacing.sm,
  },
  experienceName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  prompt: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  helper: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  ratingCard: {
    gap: theme.spacing.sm,
  },
  ratingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  ratingHeading: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  ratingChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionBtn: {
    alignSelf: 'stretch',
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
  },
});
