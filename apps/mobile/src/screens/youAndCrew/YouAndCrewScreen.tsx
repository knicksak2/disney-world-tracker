/**
 * YouAndCrewScreen — Composed profile identity, friends list, sharing, and account settings.
 * (Task 10.2, Requirements 7.1, 7.2, 7.3, 7.4, design.md Section 6)
 *
 * Re-homes social and identity surfaces:
 *   - Identity Block (avatar presentation & picker, display name editor) via ProfileIdentityBlock
 *   - Shared Items: Inbox and Sent entry cards
 *   - Friends & Crew: Current friends list, compare deep link, remove friend, outgoing requests, and Find Friends
 *   - Settings: Push notification preferences, change password, and logout
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { isAvatarPresetId, MAX_INLINE_FRIENDS, type ProfileDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { ProfileIdentityBlock } from '../ProfileScreen';
import PushNotificationPreferenceControl from '../PushNotificationPreferenceControl';
import ChangePasswordControl from '../ChangePasswordControl';
import { invalidatePushRegistration } from '../../hooks/usePushRegistration';
import { useSessionStore } from '../../state/sessionStore';
import { friendsErrorMessage } from '../friends/errorMessages';

type NavigationProp = NativeStackNavigationProp<YouAndCrewStackParamList, 'YouAndCrewMain'>;

interface MeResponse {
  readonly user: {
    readonly id: string;
    readonly email: string;
  };
  readonly profile: {
    readonly displayName: string;
    readonly avatarPreset: string | null;
  };
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
}

interface FriendsAndRequests {
  readonly friends: readonly FriendListEntry[];
  readonly incomingRequests: readonly FriendRequestListEntry[];
  readonly outgoingRequests: readonly FriendRequestListEntry[];
}

export default function YouAndCrewScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const clearToken = useSessionStore((state) => state.clearToken);

  const [friendsExpanded, setFriendsExpanded] = useState(false);
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});

  const setRowError = useCallback((userId: string, message: string | null) => {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message === null) {
        delete next[userId];
      } else {
        next[userId] = message;
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });

  const ownUserId = meQuery.data?.user.id;

  const profileQuery = useQuery<ProfileDTO, ApiError>({
    queryKey: ['profile', ownUserId ?? null],
    enabled: ownUserId !== undefined,
    queryFn: () =>
      apiRequest<ProfileDTO>('GET', `/users/${encodeURIComponent(ownUserId!)}/profile`),
  });

  const friendsQuery = useQuery<FriendsAndRequests, ApiError>({
    queryKey: ['friends'],
    queryFn: () => apiRequest<FriendsAndRequests>('GET', '/me/friends'),
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const removeFriendMutation = useMutation<void, ApiError, string>({
    mutationFn: async (otherUserId: string) => {
      await apiRequest<null>('DELETE', `/me/friends/${encodeURIComponent(otherUserId)}`);
    },
    onSuccess: (_data, otherUserId) => {
      setRowError(otherUserId, null);
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (err, otherUserId) => {
      setRowError(otherUserId, friendsErrorMessage(err));
    },
  });

  const handleRemoveFriend = useCallback(
    (friend: { readonly userId: string; readonly displayName: string }) => {
      Alert.alert(
        `Remove ${friend.displayName}?`,
        `Are you sure you want to remove ${friend.displayName} from your crew? You will need to send a new friend request to reconnect.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              setRowError(friend.userId, null);
              removeFriendMutation.mutate(friend.userId);
            },
          },
        ],
      );
    },
    [removeFriendMutation],
  );

  const logoutMutation = useMutation<void, ApiError, void>({
    mutationFn: async () => {
      void invalidatePushRegistration();
      await apiRequest<null>('POST', '/auth/logout');
    },
    onSettled: async () => {
      await clearToken();
      queryClient.clear();
    },
  });

  const friends = friendsQuery.data?.friends ?? [];
  const outgoingRequests = friendsQuery.data?.outgoingRequests ?? [];
  const visibleFriends = friendsExpanded
    ? friends
    : friends.slice(0, MAX_INLINE_FRIENDS);

  return (
    <ScreenContainer style={styles.container} testID="you-and-crew-screen">
      <GradientHeader
        eyebrow="👤 Profile & Crew"
        title={
          profileQuery.data?.displayName ??
          meQuery.data?.profile?.displayName ??
          'You & Crew'
        }
        subtitle="Manage your profile, friends & sharing"
        icon="people"
        {...(navigation?.canGoBack?.() ? { onBack: () => navigation.goBack() } : {})}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: User Identity (Requirements 7.2, 7.4) */}
        <View style={styles.section} testID="you-and-crew-identity-section">
          <SectionLabel>Your Identity</SectionLabel>
          {profileQuery.isLoading && !profileQuery.data ? (
            <Card style={styles.loadingCard}>
              <ActivityIndicator color={theme.color.primary} />
            </Card>
          ) : profileQuery.data ? (
            <ProfileIdentityBlock
              profile={profileQuery.data}
              isSelf={true}
            />
          ) : (
            <Card style={styles.loadingCard}>
              <Text style={styles.errorText}>Could not load profile identity.</Text>
            </Card>
          )}
        </View>

        {/* Section 2: Friends & Crew (Requirements 7.2, 7.3, 7.7) */}
        <View style={styles.section} testID="you-and-crew-friends-section">
          <View style={styles.sectionHeaderRow}>
            <View style={styles.titleWithBadge}>
              <SectionLabel>My Friends (Crew)</SectionLabel>
              {friends.length > 0 ? (
                <Badge label={String(friends.length)} color={theme.color.primary} />
              ) : null}
            </View>
            <Pressable
              onPress={() => navigation.navigate('FriendsSearch')}
              accessibilityRole="button"
              accessibilityLabel="Add friends"
              testID="find-friends-button"
              hitSlop={8}
            >
              <Text style={styles.addFriendsLink}>+ Add Friends</Text>
            </Pressable>
          </View>

          {friendsQuery.isLoading && !friendsQuery.data ? (
            <Card style={styles.loadingCard}>
              <ActivityIndicator color={theme.color.primary} />
            </Card>
          ) : friends.length === 0 && outgoingRequests.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No friends yet"
              body="Tap Find Friends to connect with your crew."
              testID="friends-empty"
            />
          ) : (
            <View style={styles.friendsList}>
              {visibleFriends.map((friend) => {
                const err = rowErrors[friend.userId];
                const isRemoving =
                  removeFriendMutation.isPending &&
                  removeFriendMutation.variables === friend.userId;

                return (
                  <Card
                    key={friend.userId}
                    style={styles.friendCard}
                    testID={`friends-friend-${friend.userId}`}
                    onPress={() =>
                      navigation.navigate('FriendProfile', {
                        friendId: friend.userId,
                        displayName: friend.displayName,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View ${friend.displayName}'s profile`}
                  >
                    <View style={styles.friendRow}>
                      <View style={styles.friendInfo}>
                        <View style={styles.friendAvatarWrap}>
                          {isAvatarPresetId(friend.avatarPreset) ? (
                            renderAvatarPreset(friend.avatarPreset, 36)
                          ) : (
                            <View style={styles.avatarPlaceholder}>
                              <Text style={styles.avatarPlaceholderText}>
                                {friend.displayName.slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.friendDetails}>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {friend.displayName}
                          </Text>
                          <Text style={styles.friendSubtitle}>Friend</Text>
                          {err ? <Text style={styles.errorText}>{err}</Text> : null}
                        </View>
                      </View>

                      <View style={styles.friendActions}>
                        <Pressable
                          style={styles.compareBtn}
                          onPress={() =>
                            navigation.navigate('FriendProfile', {
                              friendId: friend.userId,
                              displayName: friend.displayName,
                              initialSection: 'comparison',
                            })
                          }
                          testID={`compare-friend-${friend.userId}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Compare progress with ${friend.displayName}`}
                        >
                          <Text style={styles.compareBtnText}>Compare Stats</Text>
                        </Pressable>
                        <Pressable
                          style={styles.removeIconBtn}
                          disabled={isRemoving}
                          onPress={() => handleRemoveFriend(friend)}
                          testID={`remove-friend-${friend.userId}`}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${friend.displayName}`}
                          hitSlop={6}
                        >
                          <Ionicons
                            name="person-remove-outline"
                            size={16}
                            color={
                              isRemoving
                                ? theme.color.textSecondary
                                : theme.color.danger
                            }
                          />
                        </Pressable>
                      </View>
                    </View>
                  </Card>
                );
              })}

              {friends.length > MAX_INLINE_FRIENDS && (
                <Pressable
                  style={styles.toggleExpandBtn}
                  onPress={() => setFriendsExpanded((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    friendsExpanded
                      ? 'Show fewer friends'
                      : `Show all ${friends.length} friends`
                  }
                  testID="toggle-all-friends-button"
                >
                  <Text style={styles.toggleExpandText}>
                    {friendsExpanded
                      ? 'Show fewer'
                      : `Show all (${friends.length}) friends \u25BE`}
                  </Text>
                </Pressable>
              )}

              {outgoingRequests.length > 0 ? (
                <View style={styles.outgoingSection}>
                  <Text style={styles.outgoingTitle}>
                    Outgoing Requests ({outgoingRequests.length})
                  </Text>
                  {outgoingRequests.map((req) => (
                    <Card
                      key={req.id}
                      style={styles.outgoingCard}
                      testID={`outgoing-request-${req.id}`}
                    >
                      <Text style={styles.outgoingName}>{req.otherDisplayName}</Text>
                      <Badge label="Pending" color={theme.color.warning} />
                    </Card>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* Section 3: Shared Items Entry Points (Requirement 7.2) */}
        <View style={styles.section}>
          <SectionLabel>Shared Items</SectionLabel>
          <View style={styles.cardsRow}>
            {/* Inbox */}
            <Card style={styles.halfCard} testID="you-and-crew-inbox-card">
              <Pressable
                style={styles.cardPressable}
                onPress={() => navigation.navigate('Inbox')}
                accessibilityRole="button"
                accessibilityLabel="View Shared Inbox"
                testID="inbox-entry-button"
              >
                <View style={[styles.iconCircle, { backgroundColor: '#e3f2fd' }]}>
                  <Ionicons name="mail-outline" size={24} color="#1976d2" />
                </View>
                <Text style={styles.cardTitle}>Share Inbox</Text>
                <Text style={styles.cardSubtitle} numberOfLines={2}>
                  Shared with you
                </Text>
              </Pressable>
            </Card>

            {/* Sent */}
            <Card style={styles.halfCard} testID="you-and-crew-sent-card">
              <Pressable
                style={styles.cardPressable}
                onPress={() => navigation.navigate('Sent')}
                accessibilityRole="button"
                accessibilityLabel="View Sent Shares"
                testID="sent-entry-button"
              >
                <View style={[styles.iconCircle, { backgroundColor: '#f3e5f5' }]}>
                  <Ionicons name="paper-plane-outline" size={24} color="#7b1fa2" />
                </View>
                <Text style={styles.cardTitle}>Sent Shares</Text>
                <Text style={styles.cardSubtitle} numberOfLines={2}>
                  Sent by you
                </Text>
              </Pressable>
            </Card>
          </View>
        </View>

        {/* Section 4: Preferences & Security (Requirements 7.2, 7.6) */}
        <View
          style={styles.section}
          testID="you-and-crew-settings-section"
        >
          <SectionLabel>Preferences &amp; Security</SectionLabel>

          <Card style={styles.settingsCard}>
            <View style={styles.settingsCardHeader}>
              <Ionicons name="notifications-outline" size={16} color={theme.color.primary} />
              <Text style={styles.settingsTitle}>Push Notifications</Text>
            </View>
            <PushNotificationPreferenceControl />
          </Card>

          <Card style={styles.settingsCard}>
            <View style={styles.settingsCardHeader}>
              <Ionicons name="shield-checkmark-outline" size={16} color={theme.color.primary} />
              <Text style={styles.settingsTitle}>Account Security</Text>
            </View>
            <ChangePasswordControl />
          </Card>

          <View style={styles.logoutBlock}>
            <SecondaryButton
              label={logoutMutation.isPending ? 'Logging out\u2026' : 'Log out'}
              icon="log-out-outline"
              tone="danger"
              onPress={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              testID="you-and-crew-logout"
            />
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.xl,
    paddingBottom: theme.spacing.xxl,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  addFriendsLink: {
    ...theme.typography.button,
    fontSize: 13,
    color: theme.color.primary,
    fontWeight: '700',
  },
  findButton: {
    minHeight: 36,
  },
  cardsRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  halfCard: {
    flex: 1,
    padding: 0,
    overflow: 'hidden',
  },
  cardPressable: {
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.xs,
    width: '100%',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    ...theme.typography.title,
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  cardSubtitle: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
  loadingCard: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendsList: {
    gap: theme.spacing.xs,
  },
  friendCard: {
    padding: 10,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: 12,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  friendAvatarWrap: {
    marginRight: theme.spacing.sm,
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  avatarPlaceholderText: {
    ...theme.typography.subtitle,
    color: theme.color.primary,
  },
  friendDetails: {
    flex: 1,
  },
  friendName: {
    ...theme.typography.title,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  friendSubtitle: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 1,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compareBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  compareBtnText: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.primary,
  },
  removeIconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(214, 51, 108, 0.08)',
  },
  toggleExpandBtn: {
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleExpandText: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.primary,
  },
  outgoingSection: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  outgoingTitle: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
  },
  outgoingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
  },
  outgoingName: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  settingsCard: {
    padding: 14,
    gap: theme.spacing.sm,
  },
  settingsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  settingsTitle: {
    ...theme.typography.meta,
    fontWeight: '700',
    fontSize: 12,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutBlock: {
    marginTop: theme.spacing.sm,
  },
  errorText: {
    ...theme.typography.meta,
    color: theme.color.danger,
  },
});
