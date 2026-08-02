// Feature: disney-world-tracker, Task 18.1 — Friends list screen
//
// Validates: Requirements R8.4, R8.5, R8.6, R8.9, R8.11
//
// Behavior summary:
//   - Reads `GET /me/friends` and renders two sections: current Friends and
//     outgoing pending Friend_Requests (R8.9).
//   - Each current friend offers a Remove button (R8.6, R8.11).
//   - Outgoing requests are read-only (the server has no withdraw endpoint).
//   - All mutations invalidate the `['friends']` query so the list refreshes
//     without an extra round-trip per row.
//   - Mutation errors are surfaced through a per-row inline message mapped
//     via `friendsErrorMessage`.
//   - A header button navigates to `FriendsSearch` so the user can find
//     people to add.
//
// Feature: notification-center, Task 15.1 — the incoming friend-request
// accept/decline actionable section was removed from this screen (R7.1). The
// Notification_Center is now the single in-app surface for acting on pending
// Friend_Requests; the `['friends']` read is retained for the friends list and
// outgoing-request display only.
//
// Feature: social-sharing-loop, Task 6.1 — the top-level Share control was
// removed from this screen (R3.1). A Share is now initiated only from a
// Share_Entry_Point on the content being shared (R3.2).
//
// Feature: notification-center — the Inbox control was removed from this
// screen. The Share_Inbox now lives under the Notification_Center (reachable
// via the Profile_Notifications_Entry, R12.2), which is the single alerting
// surface for unread Shares (R7.7), so the Friends page no longer duplicates
// that entry point. The Friends page retains the Sent and Find controls.
//
// Styling: uses the shared "Magical / Whimsical" theme — a gradient hero
// header with Sent / Find-friends actions, section labels, rows as
// `Card`s, and themed PrimaryButton / SecondaryButton controls. Empty
// sections and the no-friends state use calm muted styling; only mutation
// failures use danger. See `theme/theme.ts` and `theme/components.tsx`.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { isAvatarPresetId } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import type { FriendsStackParamList } from '../../navigation/FriendsStack';
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
import { friendsErrorMessage } from './errorMessages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<FriendsStackParamList, 'FriendsList'>;

/**
 * Wire shape for `GET /me/friends`. Mirrors `FriendsAndRequests` from
 * `apps/api/src/services/friends/repo.ts`. Only the fields the screen
 * renders are typed here so the screen does not break when the server
 * adds optional metadata.
 */
interface FriendsAndRequests {
  readonly friends: readonly FriendListEntry[];
  readonly incomingRequests: readonly FriendRequestListEntry[];
  readonly outgoingRequests: readonly FriendRequestListEntry[];
}

interface FriendListEntry {
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

/**
 * Discriminator for a unified `FlatList` data array. We render three logical
 * groups (incoming requests, current friends, outgoing requests) plus header
 * rows; encoding them as a tagged union keeps the keyExtractor and renderItem
 * functions simple and lets the screen scroll as one list rather than three.
 */
type Row =
  | { readonly kind: 'header'; readonly id: string; readonly label: string }
  | {
      readonly kind: 'friend';
      readonly id: string;
      readonly friend: FriendListEntry;
    }
  | {
      readonly kind: 'outgoing';
      readonly id: string;
      readonly request: FriendRequestListEntry;
    }
  | { readonly kind: 'empty'; readonly id: string; readonly label: string };

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FriendsListScreen({ navigation }: Props): JSX.Element {
  const queryClient = useQueryClient();

  const friendsQuery = useQuery<FriendsAndRequests, ApiError>({
    queryKey: ['friends'],
    queryFn: () => apiRequest<FriendsAndRequests>('GET', '/me/friends'),
  });

  const { refetch: refetchFriends } = friendsQuery;

  // Refetch whenever the screen gains focus so a friend request that arrived
  // while the User was elsewhere (including one they reached by tapping a
  // friend-request push notification) shows up without needing an app
  // restart. This covers the case where the screen is already mounted in the
  // stack, so React Query's default refetch-on-mount would not fire.
  useFocusEffect(
    useCallback(() => {
      void refetchFriends();
    }, [refetchFriends]),
  );

  // Per-row error message from the most recent failed mutation. Keyed by
  // the row's stable id (request id for accept/decline, user id for remove).
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>(
    {},
  );

  const setRowError = useCallback((rowId: string, message: string | null) => {
    setRowErrors((prev) => {
      const next: Record<string, string> = { ...prev };
      if (message === null) {
        delete next[rowId];
      } else {
        next[rowId] = message;
      }
      return next;
    });
  }, []);

  const invalidateFriends = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
  }, [queryClient]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  // R8.6 / R8.11 — remove a current friend.
  const removeMutation = useMutation<void, ApiError, string>({
    mutationFn: async (otherUserId) => {
      await apiRequest<null>(
        'DELETE',
        `/me/friends/${encodeURIComponent(otherUserId)}`,
      );
    },
    onSuccess: (_data, otherUserId) => {
      setRowError(otherUserId, null);
      invalidateFriends();
    },
    onError: (err, otherUserId) => {
      setRowError(otherUserId, friendsErrorMessage(err));
    },
  });

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  const headerActions = (
    <View style={styles.headerActions}>
      <SecondaryButton
        label="Sent"
        icon="paper-plane-outline"
        onPress={() => {
          navigation.navigate('Sent');
        }}
        testID="friends-sent"
        style={styles.headerBtn}
      />
    </View>
  );

  if (friendsQuery.isLoading && friendsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Friends" icon="people" />
        <View style={styles.center} testID="friends-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (friendsQuery.isError && friendsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Friends" icon="people" />
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load your friends"
            body={friendsErrorMessage(friendsQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void friendsQuery.refetch();
            }}
            testID="friends-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const data = friendsQuery.data ?? {
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
  };

  const rows = buildRows(data);
  const totalContent = data.friends.length + data.outgoingRequests.length;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Friends"
        subtitle="Share the magic with your crew."
        icon="people"
        right={
          <PrimaryButton
            label="Find"
            icon="person-add-outline"
            onPress={() => {
              navigation.navigate('FriendsSearch');
            }}
            testID="friends-find"
          />
        }
      />

      {headerActions}

      {totalContent === 0 ? (
        <View style={styles.center} testID="friends-empty">
          <EmptyState
            icon="people-outline"
            title="No friends yet"
            body="Tap &ldquo;Find&rdquo; to search for people you know."
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => {
            switch (item.kind) {
              case 'header':
                return <SectionHeader label={item.label} />;
              case 'empty':
                return <SectionEmpty label={item.label} />;
              case 'friend':
                return (
                  <FriendRow
                    friend={item.friend}
                    error={rowErrors[item.friend.userId] ?? null}
                    busy={
                      removeMutation.isPending &&
                      removeMutation.variables === item.friend.userId
                    }
                    onRemove={() => {
                      setRowError(item.friend.userId, null);
                      removeMutation.mutate(item.friend.userId);
                    }}
                    onPress={() => {
                      navigation.navigate('FriendProfile', {
                        friendId: item.friend.userId,
                        displayName: item.friend.displayName,
                      });
                    }}
                  />
                );
              case 'outgoing':
                return <OutgoingRequestRow request={item.request} />;
            }
          }}
          contentContainerStyle={styles.listContent}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Row builders + components
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of rows from the server response. Sections are
 * always emitted (even when empty) so the user always sees the three
 * affordances; an empty section renders a single "no entries" line so the
 * header is not orphaned.
 */
function buildRows(data: FriendsAndRequests): readonly Row[] {
  const rows: Row[] = [];

  rows.push({
    kind: 'header',
    id: 'header-friends',
    label: `Friends (${data.friends.length})`,
  });
  if (data.friends.length === 0) {
    rows.push({
      kind: 'empty',
      id: 'empty-friends',
      label: 'No friends yet.',
    });
  } else {
    for (const friend of data.friends) {
      rows.push({ kind: 'friend', id: `friend-${friend.userId}`, friend });
    }
  }

  rows.push({
    kind: 'header',
    id: 'header-outgoing',
    label: `Outgoing requests (${data.outgoingRequests.length})`,
  });
  if (data.outgoingRequests.length === 0) {
    rows.push({
      kind: 'empty',
      id: 'empty-outgoing',
      label: 'No outgoing requests.',
    });
  } else {
    for (const request of data.outgoingRequests) {
      rows.push({ kind: 'outgoing', id: `outgoing-${request.id}`, request });
    }
  }

  return rows;
}

function SectionHeader({ label }: { readonly label: string }): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

function SectionEmpty({ label }: { readonly label: string }): JSX.Element {
  return (
    <View style={styles.sectionEmpty}>
      <Text style={styles.sectionEmptyText}>{label}</Text>
    </View>
  );
}

/**
 * Small circular avatar for a friend row. Renders the friend's chosen preset
 * badge, or a placeholder disc with their first initial when no preset is set
 * (or the stored id is unknown to this client build).
 */
function FriendAvatar({
  preset,
  displayName,
}: {
  readonly preset: string | null;
  readonly displayName: string;
}): JSX.Element {
  const art = isAvatarPresetId(preset) ? renderAvatarPreset(preset, 40) : null;
  if (art !== null) {
    return (
      <View style={styles.avatar} testID="friend-row-avatar">
        {art}
      </View>
    );
  }
  return (
    <View
      style={[styles.avatar, styles.avatarPlaceholder]}
      testID="friend-row-avatar-placeholder"
    >
      <Text style={styles.avatarPlaceholderText}>
        {displayName.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

interface FriendRowProps {
  readonly friend: FriendListEntry;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onRemove: () => void;
  readonly onPress: () => void;
}

function FriendRow({
  friend,
  error,
  busy,
  onRemove,
  onPress,
}: FriendRowProps): JSX.Element {
  return (
    <Card
      accentColor={theme.color.primary}
      style={styles.row}
      onPress={onPress}
      testID={`friends-friend-${friend.userId}`}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowIdentity}>
          <FriendAvatar
            preset={friend.avatarPreset}
            displayName={friend.displayName}
          />
          <Text style={styles.rowName}>{friend.displayName}</Text>
        </View>
        <SecondaryButton
          label={busy ? 'Removing\u2026' : 'Remove'}
          icon="person-remove-outline"
          tone="danger"
          onPress={onRemove}
          disabled={busy}
          testID={`friends-remove-${friend.userId}`}
        />
      </View>
      {error !== null ? <Text style={styles.rowError}>{error}</Text> : null}
    </Card>
  );
}

function OutgoingRequestRow({
  request,
}: {
  readonly request: FriendRequestListEntry;
}): JSX.Element {
  return (
    <Card style={styles.row} testID={`friends-outgoing-${request.id}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{request.otherDisplayName}</Text>
        <Badge label="Pending" color={theme.color.warning} icon="time-outline" />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  headerBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  sectionHeader: {
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  sectionHeaderText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionEmpty: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  sectionEmptyText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  row: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  rowIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexShrink: 1,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: theme.color.surfaceAlt,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    ...theme.typography.subtitle,
    color: theme.color.primary,
  },
  rowError: {
    ...theme.typography.meta,
    color: theme.color.danger,
  },
});
