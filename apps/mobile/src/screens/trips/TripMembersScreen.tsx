// Feature: trips, Task 17.10 — Trip_Members section
//
// Validates: Requirements 18.1, 18.6, 4.5, 4.6, 4.8, 6.1, 6.8, 8.1, 8.2
//
// Behavior summary:
//   - This is the Trip_Members section of the Trip_Detail_View hub (the
//     `TripMembers` route, R18.1/R18.6). It reads `GET /trips/:id/members`
//     (returning `TripMemberDTO[]`) for the roster and `GET /me` to identify
//     the caller so it can gate self-scoped controls. Membership is enforced
//     server-side; a non-member / missing Trip collapses to the same
//     `trip_forbidden` response, surfaced as an error with Retry (R15.2).
//   - Every Member is listed with their display name and role. An Organizer
//     (the caller's own role, read from the roster) additionally sees, per
//     other Member: a promote control on a `member` (R4.5), a demote control on
//     an `organizer` (R4.6), and a remove control (R8.2). Promote is only shown
//     for `member`s and demote only for `organizer`s so the request is never a
//     no-op the server would reject (R4.8). The caller sees a Leave control for
//     themselves (R8.1). The server re-enforces the role matrix and the
//     Last_Organizer_Rule, so these controls are UX guards, not the authority
//     (a `trip_last_organizer` rejection is surfaced as friendly copy).
//   - An Organizer can invite a Friend who is not already a Member via a picker
//     backed by `GET /me/friends`, POSTing `POST /trips/:id/invites` (R6.1).
//     Friends who are already Members are excluded (R6.4). The invited User is
//     notified server-side with a deep-link to the created invite (R6.6, R6.7).
//
// The roster's outstanding invites are read from `GET /trips/:id/invites`
// (Organizer-gated), so pending invites persist across sessions: the invite
// picker excludes Friends who are already invited (R6.5) and the roster shows
// each pending invite with a Cancel control (`POST .../invites/:id/cancel`,
// R6.8). Styling follows the shared "Magical / Whimsical" theme, mirroring
// `TripDetailScreen`.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import type {
  TripMemberDTO,
  TripPendingInviteDTO,
  TripRole,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripMembers'>;

/** Wire shape of `GET /me`: the caller's identity (to gate self controls). */
interface MeResponse {
  readonly user: { readonly id: string };
}

/** Wire shape of `GET /trips/:id/members`: the Trip's current Members. */
type TripMembersResponse = readonly TripMemberDTO[];

/** Wire shape of `GET /trips/:id/invites`: the Trip's pending invites. */
type TripPendingInvitesResponse = readonly TripPendingInviteDTO[];

/** One entry in the `friends` array of `GET /me/friends`. */
interface FriendsListEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
  readonly establishedAt: string;
}

interface FriendRequestListEntry {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

interface FriendsAndRequestsResponse {
  readonly friends: ReadonlyArray<FriendsListEntry>;
  readonly incomingRequests: ReadonlyArray<FriendRequestListEntry>;
  readonly outgoingRequests: ReadonlyArray<FriendRequestListEntry>;
}

/** Wire shape of `POST /trips/:id/invites`: the created invite's identity. */
interface TripInviteCreatedResponse {
  readonly inviteId: string;
  readonly tripId: string;
  readonly inviterId: string;
  readonly inviteeId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query keys for the reads this screen depends on. */
export const tripMembersKeys = {
  members: (tripId: string) => ['trips', 'members', tripId] as const,
  invites: (tripId: string) => ['trips', 'invites', tripId] as const,
  friends: () => ['me-friends'] as const,
};

/** Human labels + badge colors for each Trip_Role. */
const ROLE_META: Record<TripRole, { readonly label: string; readonly color: string }> = {
  organizer: { label: 'Organizer', color: theme.color.primary },
  member: { label: 'Member', color: theme.color.textSecondary },
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripMembersScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });

  const membersQuery = useQuery<TripMembersResponse, ApiError>({
    queryKey: tripMembersKeys.members(tripId),
    queryFn: () =>
      apiRequest<TripMembersResponse>('GET', `/trips/${tripId}/members`),
  });

  const [inviteVisible, setInviteVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const ownUserId = meQuery.data?.user.id ?? null;
  const members = membersQuery.data ?? [];
  const ownMember = members.find((m) => m.userId === ownUserId) ?? null;
  const isOrganizer = ownMember?.role === 'organizer';

  // Outstanding invites for the roster and to exclude already-invited Friends
  // from the picker (R6.5, R6.8). Organizer-gated, so it only runs once the
  // roster confirms the caller is an Organizer.
  const invitesQuery = useQuery<TripPendingInvitesResponse, ApiError>({
    queryKey: tripMembersKeys.invites(tripId),
    queryFn: () =>
      apiRequest<TripPendingInvitesResponse>('GET', `/trips/${tripId}/invites`),
    enabled: isOrganizer,
  });

  const pendingInvites = invitesQuery.data ?? [];

  const backToHub = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TripDetail', { tripId });
  };

  const invalidateMembers = (): void => {
    void queryClient.invalidateQueries({
      queryKey: tripMembersKeys.members(tripId),
    });
  };

  const invalidateInvites = (): void => {
    void queryClient.invalidateQueries({
      queryKey: tripMembersKeys.invites(tripId),
    });
  };

  // Organizer role/removal mutations. Each targets a Member by userId and, on
  // success, refetches the roster so the UI reflects the new role/set.
  const roleMutation = useMutation<
    void,
    ApiError,
    { readonly userId: string; readonly action: 'promote' | 'demote' | 'remove' }
  >({
    mutationFn: async ({ userId, action }) => {
      if (action === 'remove') {
        await apiRequest<void>('DELETE', `/trips/${tripId}/members/${userId}`);
        return;
      }
      await apiRequest<void>(
        'POST',
        `/trips/${tripId}/members/${userId}/${action}`,
      );
    },
    onSuccess: () => {
      setActionError(null);
      invalidateMembers();
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  // Leave the Trip (R8.1). On success the caller is no longer a Member, so the
  // Trip detail would collapse to `trip_forbidden`; return to the Trips list.
  const leaveMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await apiRequest<void>('POST', `/trips/${tripId}/leave`);
    },
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigation.navigate('TripsList');
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  // Cancel a pending invite the caller sent this session (R6.8).
  const cancelInviteMutation = useMutation<void, ApiError, string>({
    mutationFn: async (inviteId) => {
      await apiRequest<void>(
        'POST',
        `/trips/${tripId}/invites/${inviteId}/cancel`,
      );
    },
    onSuccess: () => {
      setActionError(null);
      invalidateInvites();
    },
    onError: (err) => {
      setActionError(actionErrorMessage(err));
    },
  });

  const busy =
    roleMutation.isPending ||
    leaveMutation.isPending ||
    cancelInviteMutation.isPending;

  const loading =
    (meQuery.isLoading && meQuery.data === undefined) ||
    (membersQuery.isLoading && membersQuery.data === undefined);

  const loadError =
    (meQuery.isError && meQuery.data === undefined) ||
    (membersQuery.isError && membersQuery.data === undefined);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <ScreenContainer>
        <MembersHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-members-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Load error (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (loadError) {
    return (
      <ScreenContainer>
        <MembersHeader onBack={backToHub} />
        <View style={styles.center} testID="trip-members-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load the members"
            body={readErrorMessage(membersQuery.error ?? meQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void meQuery.refetch();
              void membersQuery.refetch();
            }}
            testID="trip-members-retry"
            style={styles.actionBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <MembersHeader
        onBack={backToHub}
        right={
          isOrganizer ? (
            <PrimaryButton
              label="Invite"
              icon="person-add-outline"
              onPress={() => {
                setActionError(null);
                setInviteVisible(true);
              }}
              testID="trip-members-invite-open"
            />
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content} testID="trip-members">
        {actionError !== null ? (
          <Text
            style={styles.error}
            accessibilityRole="alert"
            testID="trip-members-action-error"
          >
            {actionError}
          </Text>
        ) : null}

        {members.map((member) => {
          const isSelf = member.userId === ownUserId;
          const roleMeta = ROLE_META[member.role];
          return (
            <Card
              key={member.userId}
              style={styles.memberCard}
              testID={`trip-member-${member.userId}`}
            >
              <View style={styles.memberRow}>
                <MemberAvatar displayName={member.displayName} />
                <View style={styles.memberIdentity}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.displayName}
                    {isSelf ? ' (You)' : ''}
                  </Text>
                  <Badge label={roleMeta.label} color={roleMeta.color} />
                </View>
              </View>

              <View style={styles.memberActions}>
                {/* The caller's own Leave control (R8.1). */}
                {isSelf ? (
                  <SecondaryButton
                    label="Leave trip"
                    icon="exit-outline"
                    tone="danger"
                    onPress={() => {
                      if (busy) return;
                      setActionError(null);
                      leaveMutation.mutate();
                    }}
                    disabled={busy}
                    testID="trip-members-leave"
                  />
                ) : null}

                {/* Organizer controls over other Members (R4.5, R4.6, R8.2). */}
                {isOrganizer && !isSelf ? (
                  <>
                    {member.role === 'member' ? (
                      <SecondaryButton
                        label="Promote"
                        icon="arrow-up-circle-outline"
                        onPress={() => {
                          if (busy) return;
                          setActionError(null);
                          roleMutation.mutate({
                            userId: member.userId,
                            action: 'promote',
                          });
                        }}
                        disabled={busy}
                        testID={`trip-member-promote-${member.userId}`}
                      />
                    ) : (
                      <SecondaryButton
                        label="Demote"
                        icon="arrow-down-circle-outline"
                        onPress={() => {
                          if (busy) return;
                          setActionError(null);
                          roleMutation.mutate({
                            userId: member.userId,
                            action: 'demote',
                          });
                        }}
                        disabled={busy}
                        testID={`trip-member-demote-${member.userId}`}
                      />
                    )}
                    <SecondaryButton
                      label="Remove"
                      icon="person-remove-outline"
                      tone="danger"
                      onPress={() => {
                        if (busy) return;
                        setActionError(null);
                        roleMutation.mutate({
                          userId: member.userId,
                          action: 'remove',
                        });
                      }}
                      disabled={busy}
                      testID={`trip-member-remove-${member.userId}`}
                    />
                  </>
                ) : null}
              </View>
            </Card>
          );
        })}

        {/* Outstanding invites, each with a Cancel control (R6.8). */}
        {isOrganizer && pendingInvites.length > 0 ? (
          <View style={styles.invitesSection} testID="trip-members-pending-invites">
            <Text style={styles.sectionLabel}>Invited</Text>
            {pendingInvites.map((invite) => (
              <Card
                key={invite.inviteId}
                style={styles.memberCard}
                testID={`trip-invite-${invite.inviteId}`}
              >
                <View style={styles.memberRow}>
                  <MemberAvatar displayName={invite.inviteeDisplayName} />
                  <View style={styles.memberIdentity}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {invite.inviteeDisplayName}
                    </Text>
                    <Badge label="Invite pending" color={theme.color.accent} />
                  </View>
                </View>
                <View style={styles.memberActions}>
                  <SecondaryButton
                    label="Cancel invite"
                    icon="close-circle-outline"
                    tone="danger"
                    onPress={() => {
                      if (busy) return;
                      setActionError(null);
                      cancelInviteMutation.mutate(invite.inviteId);
                    }}
                    disabled={busy}
                    testID={`trip-invite-cancel-${invite.inviteId}`}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {busy ? (
          <ActivityIndicator
            color={theme.color.primary}
            style={styles.busy}
            testID="trip-members-busy"
          />
        ) : null}
      </ScrollView>

      {isOrganizer ? (
        <InviteModal
          visible={inviteVisible}
          tripId={tripId}
          members={members}
          pendingInvites={pendingInvites}
          onClose={() => {
            setInviteVisible(false);
          }}
          onInvited={() => {
            invalidateInvites();
          }}
        />
      ) : null}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Invite modal — pick a Friend who is not already a Member (R6.1, R6.4)
// ---------------------------------------------------------------------------

function InviteModal({
  visible,
  tripId,
  members,
  pendingInvites,
  onClose,
  onInvited,
}: {
  readonly visible: boolean;
  readonly tripId: string;
  readonly members: readonly TripMemberDTO[];
  readonly pendingInvites: readonly TripPendingInviteDTO[];
  readonly onClose: () => void;
  readonly onInvited: () => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const friendsQuery = useQuery<FriendsAndRequestsResponse, ApiError>({
    queryKey: tripMembersKeys.friends(),
    queryFn: () =>
      apiRequest<FriendsAndRequestsResponse>('GET', '/me/friends'),
    enabled: visible,
  });

  // Candidates: Friends who are not already Members (R6.4) and have no pending
  // invite (R6.5). The server re-enforces both, so this is a UX guard.
  const candidates = useMemo<readonly FriendsListEntry[]>(() => {
    const friends = friendsQuery.data?.friends ?? [];
    const memberIds = new Set(members.map((m) => m.userId));
    const invitedIds = new Set(pendingInvites.map((i) => i.inviteeId));
    return friends.filter(
      (f) => !memberIds.has(f.userId) && !invitedIds.has(f.userId),
    );
  }, [friendsQuery.data, members, pendingInvites]);

  const inviteMutation = useMutation<
    TripInviteCreatedResponse,
    ApiError,
    FriendsListEntry
  >({
    mutationFn: (friend) =>
      apiRequest<TripInviteCreatedResponse>('POST', `/trips/${tripId}/invites`, {
        userId: friend.userId,
      }),
    onSuccess: () => {
      setError(null);
      onInvited();
    },
    onError: (err) => {
      setError(inviteErrorMessage(err));
    },
  });

  const busy = inviteMutation.isPending;

  const closeAndReset = (): void => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeAndReset}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="trip-members-invite-modal">
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={styles.modalTitle}>Invite a friend</Text>
            <Text style={styles.helper}>
              Only your friends can be invited. Tap a friend to send them an
              invite to this trip.
            </Text>

            {friendsQuery.isLoading && friendsQuery.data === undefined ? (
              <View style={styles.center} testID="trip-members-invite-loading">
                <ActivityIndicator color={theme.color.primary} />
              </View>
            ) : friendsQuery.isError && friendsQuery.data === undefined ? (
              <Text style={styles.error} testID="trip-members-invite-load-error">
                We couldn't load your friends. Please try again.
              </Text>
            ) : candidates.length === 0 ? (
              <EmptyState
                icon="people-outline"
                title="No friends to invite"
                body="Everyone you're friends with is already on this trip, or you haven't added friends yet."
              />
            ) : (
              <View style={styles.candidateList} testID="trip-members-invite-list">
                {candidates.map((friend) => (
                  <Card
                    key={friend.userId}
                    style={styles.candidateCard}
                    onPress={() => {
                      if (busy) return;
                      setError(null);
                      inviteMutation.mutate(friend);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${friend.displayName}`}
                    testID={`trip-members-invite-candidate-${friend.userId}`}
                  >
                    <View style={styles.memberRow}>
                      <MemberAvatar displayName={friend.displayName} />
                      <Text style={styles.memberName} numberOfLines={1}>
                        {friend.displayName}
                      </Text>
                      <Ionicons
                        name="add-circle-outline"
                        size={22}
                        color={theme.color.primary}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}

            {error !== null ? (
              <Text
                style={styles.error}
                accessibilityRole="alert"
                testID="trip-members-invite-error"
              >
                {error}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <SecondaryButton
                label="Done"
                onPress={closeAndReset}
                disabled={busy}
                testID="trip-members-invite-done"
                style={styles.flexBtn}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** A small circular avatar showing the first initial of a display name. */
function MemberAvatar({ displayName }: { readonly displayName: string }): JSX.Element {
  const initial = displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

/** Shared compact header for every state of the Members screen. */
function MembersHeader({
  onBack,
  right,
}: {
  readonly onBack: () => void;
  readonly right?: React.ReactNode;
}): JSX.Element {
  return (
    <GradientHeader
      title="Members"
      subtitle="Who is on this trip and their roles."
      icon="people"
      compact
      onBack={onBack}
      right={right}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a read error to user-facing copy (non-disclosure, R15.2). */
function readErrorMessage(err: ApiError | null | undefined): string {
  if (err === null || err === undefined) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map a role/leave/cancel action error to user-facing copy. */
function actionErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'trip_last_organizer':
      return 'A trip must always have at least one organizer.';
    case 'trip_role_invalid':
      return 'That member already has that role.';
    case 'trip_forbidden':
      return 'Only organizers can manage members.';
    case 'trip_not_found':
      return 'This trip is no longer available.';
    case 'trip_validation_failed':
      return 'That member is not on this trip.';
    case 'trip_invite_state_invalid':
      return 'That invite is no longer pending.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

/** Map an invite-send error to user-facing copy. */
function inviteErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'trip_not_friend':
      return 'You can only invite people you are friends with.';
    case 'trip_invite_duplicate':
      return 'They already have a pending invite or are already on this trip.';
    case 'trip_forbidden':
      return 'Only organizers can send invites.';
    case 'trip_not_found':
      return 'This trip is no longer available.';
    case 'trip_validation_failed':
      return 'That person can\u2019t be invited.';
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
  actionBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  memberCard: {
    gap: theme.spacing.md,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  memberIdentity: {
    flexShrink: 1,
    flexGrow: 1,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  memberName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  memberActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  invitesSection: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  sectionLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
  },
  avatarText: {
    ...theme.typography.subtitle,
    color: theme.color.primary,
  },
  busy: {
    alignSelf: 'center',
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    ...theme.shadow.floating,
  },
  modalScroll: {
    gap: theme.spacing.sm,
  },
  modalTitle: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  helper: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  candidateList: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  candidateCard: {
    marginBottom: 0,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
