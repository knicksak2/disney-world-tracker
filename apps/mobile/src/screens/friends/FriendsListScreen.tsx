// Feature: disney-world-tracker, Task 18.1 — Friends list screen
//
// Validates: Requirements R8.4, R8.5, R8.6, R8.9, R8.11
//
// Behavior summary:
//   - Reads `GET /me/friends` and renders three sections: current Friends,
//     incoming pending Friend_Requests, and outgoing pending Friend_Requests
//     (R8.9).
//   - Each incoming request offers Accept (R8.4) and Decline (R8.5) buttons.
//   - Each current friend offers a Remove button (R8.6, R8.11).
//   - Outgoing requests are read-only (the server has no withdraw endpoint).
//   - All mutations invalidate the `['friends']` query so the list refreshes
//     without an extra round-trip per row.
//   - Mutation errors are surfaced through a per-row inline message mapped
//     via `friendsErrorMessage`.
//   - A header button navigates to `FriendsSearch` so the user can find
//     people to add.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import type { FriendsStackParamList } from '../../navigation/FriendsStack';
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
  readonly avatarUrl: string | null;
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
      readonly kind: 'incoming';
      readonly id: string;
      readonly request: FriendRequestListEntry;
    }
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

  // R8.4 — accept a pending incoming request, server responds 204 on success.
  const acceptMutation = useMutation<void, ApiError, string>({
    mutationFn: async (requestId) => {
      await apiRequest<null>(
        'POST',
        `/me/friend-requests/${encodeURIComponent(requestId)}/accept`,
      );
    },
    onSuccess: (_data, requestId) => {
      setRowError(requestId, null);
      invalidateFriends();
    },
    onError: (err, requestId) => {
      setRowError(requestId, friendsErrorMessage(err));
    },
  });

  // R8.5 — decline a pending incoming request.
  const declineMutation = useMutation<void, ApiError, string>({
    mutationFn: async (requestId) => {
      await apiRequest<null>(
        'POST',
        `/me/friend-requests/${encodeURIComponent(requestId)}/decline`,
      );
    },
    onSuccess: (_data, requestId) => {
      setRowError(requestId, null);
      invalidateFriends();
    },
    onError: (err, requestId) => {
      setRowError(requestId, friendsErrorMessage(err));
    },
  });

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

  if (friendsQuery.isLoading && friendsQuery.data === undefined) {
    return (
      <View style={styles.center} testID="friends-loading">
        <ActivityIndicator />
      </View>
    );
  }

  if (friendsQuery.isError && friendsQuery.data === undefined) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>We couldn&rsquo;t load your friends.</Text>
        <Text style={styles.errorBody}>{friendsErrorMessage(friendsQuery.error)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void friendsQuery.refetch();
          }}
          style={styles.button}
          testID="friends-retry"
        >
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const data = friendsQuery.data ?? {
    friends: [],
    incomingRequests: [],
    outgoingRequests: [],
  };

  const rows = buildRows(data);
  const totalContent =
    data.friends.length +
    data.incomingRequests.length +
    data.outgoingRequests.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Friends</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              navigation.navigate('Inbox');
            }}
            style={[styles.button, styles.buttonSecondary]}
            testID="friends-inbox"
          >
            <Text style={styles.buttonText}>Inbox</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              navigation.navigate('ShareComposer');
            }}
            style={[styles.button, styles.buttonSecondary]}
            testID="friends-share"
          >
            <Text style={styles.buttonText}>Share</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              navigation.navigate('FriendsSearch');
            }}
            style={styles.button}
            testID="friends-find"
          >
            <Text style={styles.buttonText}>Find friends</Text>
          </Pressable>
        </View>
      </View>

      {totalContent === 0 ? (
        <View style={styles.center} testID="friends-empty">
          <Text style={styles.emptyTitle}>No friends yet</Text>
          <Text style={styles.emptyBody}>
            Tap &ldquo;Find friends&rdquo; to search for people you know.
          </Text>
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
              case 'incoming':
                return (
                  <IncomingRequestRow
                    request={item.request}
                    error={rowErrors[item.request.id] ?? null}
                    busy={
                      (acceptMutation.isPending &&
                        acceptMutation.variables === item.request.id) ||
                      (declineMutation.isPending &&
                        declineMutation.variables === item.request.id)
                    }
                    onAccept={() => {
                      setRowError(item.request.id, null);
                      acceptMutation.mutate(item.request.id);
                    }}
                    onDecline={() => {
                      setRowError(item.request.id, null);
                      declineMutation.mutate(item.request.id);
                    }}
                  />
                );
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
                  />
                );
              case 'outgoing':
                return <OutgoingRequestRow request={item.request} />;
            }
          }}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
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
    id: 'header-incoming',
    label: `Incoming requests (${data.incomingRequests.length})`,
  });
  if (data.incomingRequests.length === 0) {
    rows.push({
      kind: 'empty',
      id: 'empty-incoming',
      label: 'No incoming requests.',
    });
  } else {
    for (const request of data.incomingRequests) {
      rows.push({ kind: 'incoming', id: `incoming-${request.id}`, request });
    }
  }

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

interface IncomingRequestRowProps {
  readonly request: FriendRequestListEntry;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}

function IncomingRequestRow({
  request,
  error,
  busy,
  onAccept,
  onDecline,
}: IncomingRequestRowProps): JSX.Element {
  return (
    <View
      style={styles.row}
      testID={`friends-incoming-${request.id}`}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{request.otherDisplayName}</Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onAccept}
          disabled={busy}
          style={[styles.button, busy && styles.buttonDisabled]}
          testID={`friends-accept-${request.id}`}
        >
          <Text style={styles.buttonText}>Accept</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onDecline}
          disabled={busy}
          style={[
            styles.button,
            styles.buttonSecondary,
            busy && styles.buttonDisabled,
          ]}
          testID={`friends-decline-${request.id}`}
        >
          <Text style={styles.buttonText}>Decline</Text>
        </Pressable>
      </View>
      {error !== null ? <Text style={styles.rowError}>{error}</Text> : null}
    </View>
  );
}

interface FriendRowProps {
  readonly friend: FriendListEntry;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onRemove: () => void;
}

function FriendRow({
  friend,
  error,
  busy,
  onRemove,
}: FriendRowProps): JSX.Element {
  return (
    <View style={styles.row} testID={`friends-friend-${friend.userId}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{friend.displayName}</Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRemove}
          disabled={busy}
          style={[
            styles.button,
            styles.buttonDanger,
            busy && styles.buttonDisabled,
          ]}
          testID={`friends-remove-${friend.userId}`}
        >
          <Text style={styles.buttonText}>{busy ? 'Removing\u2026' : 'Remove'}</Text>
        </Pressable>
      </View>
      {error !== null ? <Text style={styles.rowError}>{error}</Text> : null}
    </View>
  );
}

function OutgoingRequestRow({
  request,
}: {
  readonly request: FriendRequestListEntry;
}): JSX.Element {
  return (
    <View style={styles.row} testID={`friends-outgoing-${request.id}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{request.otherDisplayName}</Text>
        <Text style={styles.rowMeta}>Pending</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#dddddd',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222222',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#222222',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    backgroundColor: '#f4f4f4',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#444444',
  },
  sectionEmpty: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionEmptyText: {
    fontSize: 14,
    color: '#888888',
    fontStyle: 'italic',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
    gap: 8,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowName: {
    fontSize: 16,
    color: '#111111',
    flexShrink: 1,
  },
  rowMeta: {
    fontSize: 12,
    color: '#666666',
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rowError: {
    fontSize: 13,
    color: '#b91c1c',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#6b7280',
  },
  buttonDanger: {
    backgroundColor: '#b91c1c',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
