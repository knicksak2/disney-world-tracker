// Feature: trips, Task 17.x — Trip_Invite accept/decline screen
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.7, 7.8, 7.9, 18.2
//
// Behavior summary:
//   - This is the deep-link target reached when an invited User taps a
//     Trip_Invite push notification (R18.2). It receives the notification's
//     `{ tripInviteId }` routing id as a route param and presents controls to
//     accept or decline the invite. It is also reachable in-app from the
//     Trips_List invitations section, which routes here with the same param.
//   - It reads the invite's deep-link target via `GET /me/trip-invites/:inviteId`
//     (R7.7), which returns the invite regardless of its state so the screen
//     can present accept/decline controls when `pending` and an informational
//     "no longer available" state otherwise (R7.9). The read is scoped to the
//     caller server-side, so an invite addressed to someone else collapses to
//     the same not-found fallback and cannot be probed (R15.2).
//   - While the invite is `pending`, the screen offers:
//       • Accept — posts `POST /me/trip-invites/:inviteId/accept`, which adds
//         the User as a Trip_Member and returns the joined Trip's id; the
//         screen then drops the User straight into that Trip's Trip_Detail_View
//         (R7.1, R7.2, R7.6).
//       • Decline — posts `POST /me/trip-invites/:inviteId/decline`, which adds
//         no membership (R7.3), then returns to where the User came from.
//   - When the invite is no longer `pending` (already accepted/declined/
//     cancelled) or the read fails, the screen shows an informational state
//     without accept/decline controls; the server would reject a second action
//     with `trip_invite_state_invalid` anyway (R7.5).
//   - Accepting or declining invalidates the Trips_List and its invitations
//     section so a Trip joined here appears — and a handled invite disappears —
//     without an app restart.
//
// Styling follows the shared "Magical / Whimsical" theme, mirroring
// `RodeWithConfirmScreen` (compact gradient header with a back control, themed
// cards/buttons).

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TripInviteDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { tripInvitesKeys, tripsListKeys } from './TripsListScreen';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripInvite'>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for a single invite's deep-link target, keyed by invite id. */
export const tripInviteKeys = {
  target: (inviteId: string) => ['trips', 'invite', inviteId] as const,
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripInviteScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripInviteId } = route.params;
  const queryClient = useQueryClient();

  const inviteQuery = useQuery<TripInviteDTO, ApiError>({
    queryKey: tripInviteKeys.target(tripInviteId),
    queryFn: () =>
      apiRequest<TripInviteDTO>('GET', `/me/trip-invites/${tripInviteId}`),
    retry: false,
  });

  const [actionError, setActionError] = React.useState<string | null>(null);

  const invite = inviteQuery.data;

  // Invalidate the list surfaces so a Trip joined here appears and a handled
  // invite disappears without an app restart.
  const refreshLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: tripInvitesKeys.list() });
    void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
    void queryClient.invalidateQueries({
      queryKey: tripInviteKeys.target(tripInviteId),
    });
  };

  const acceptMutation = useMutation<{ tripId: string }, ApiError, void>({
    mutationFn: () =>
      apiRequest<{ tripId: string }>(
        'POST',
        `/me/trip-invites/${tripInviteId}/accept`,
      ),
    onSuccess: (result) => {
      refreshLists();
      // R7.6 hand-off: drop the User straight into the Trip they just joined,
      // replacing this deep-link target so Back does not return to the invite.
      navigation.replace('TripDetail', { tripId: result.tripId });
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  const declineMutation = useMutation<void, ApiError, void>({
    mutationFn: () =>
      apiRequest<void>('POST', `/me/trip-invites/${tripInviteId}/decline`),
    onSuccess: () => {
      refreshLists();
      backToList();
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  const busy = acceptMutation.isPending || declineMutation.isPending;

  // A deep-link entry may have no back stack, so fall back to the Trips list.
  function backToList(): void {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripsList');
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (inviteQuery.isLoading && invite === undefined) {
    return (
      <ScreenContainer>
        <InviteHeader onBack={backToList} />
        <View style={styles.center} testID="trip-invite-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Read error — the target could not be loaded (R7.9, non-disclosing R15.2)
  // -------------------------------------------------------------------------

  if (inviteQuery.isError && invite === undefined) {
    return (
      <ScreenContainer>
        <InviteHeader onBack={backToList} />
        <View style={styles.center} testID="trip-invite-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this invitation"
            body={readErrorMessage(inviteQuery.error)}
          />
          <PrimaryButton
            label="Back to trips"
            icon="arrow-back-outline"
            onPress={backToList}
            testID="trip-invite-back"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const target = invite as TripInviteDTO;
  const isPending = target.state === 'pending';

  // -------------------------------------------------------------------------
  // Already resolved — no accept/decline controls (R7.9)
  // -------------------------------------------------------------------------

  if (!isPending) {
    return (
      <ScreenContainer>
        <InviteHeader onBack={backToList} />
        <View style={styles.center} testID="trip-invite-resolved">
          <EmptyState
            icon="information-circle-outline"
            title="Nothing to respond to"
            body={resolvedMessage(target)}
          />
          <PrimaryButton
            label="Done"
            icon="checkmark-outline"
            onPress={backToList}
            testID="trip-invite-done"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Pending — accept / decline
  // -------------------------------------------------------------------------

  return (
    <ScreenContainer>
      <InviteHeader onBack={backToList} />
      <ScrollView
        contentContainerStyle={styles.content}
        testID="trip-invite-confirm"
      >
        <Card style={styles.summaryCard} testID="trip-invite-summary">
          <Text style={styles.tripName}>{target.tripName}</Text>
          <Text style={styles.prompt}>
            {`${target.inviterDisplayName} invited you to join this trip.`}
          </Text>
          <Text style={styles.helper}>
            Accept to join and start planning together, or decline to pass on it.
          </Text>
        </Card>

        {actionError !== null ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            testID="trip-invite-action-error"
          >
            {actionError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={acceptMutation.isPending ? 'Joining\u2026' : 'Accept'}
            icon="checkmark-circle-outline"
            onPress={() => {
              setActionError(null);
              acceptMutation.mutate();
            }}
            disabled={busy}
            testID="trip-invite-accept"
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
            testID="trip-invite-decline"
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

/** Shared compact header for every state of the invite screen. */
function InviteHeader({ onBack }: { readonly onBack: () => void }): JSX.Element {
  return (
    <GradientHeader
      title="Trip invitation"
      subtitle="Accept or decline to respond."
      icon="mail-open"
      compact
      onBack={onBack}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Copy for the informational state when the invite is no longer `pending`. */
function resolvedMessage(target: TripInviteDTO): string {
  switch (target.state) {
    case 'accepted':
      return `You've already joined ${target.tripName}.`;
    case 'declined':
      return `You've already declined the invitation to ${target.tripName}.`;
    case 'cancelled':
      return `The invitation to ${target.tripName} was cancelled.`;
    default:
      return 'This invitation is no longer available.';
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
      return 'This invitation is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map an accept/decline error to user-facing copy. */
function actionErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_invite_state_invalid':
      // The invite was already handled elsewhere. Surface it in place; a
      // refetch will flip the screen to its resolved state (R7.5).
      return 'This invitation has already been handled.';
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This invitation is no longer available.';
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
  tripName: {
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
