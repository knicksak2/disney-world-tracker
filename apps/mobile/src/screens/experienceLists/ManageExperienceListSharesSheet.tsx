import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExperienceListShareDTO, ExperienceListShareRole } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface ManageExperienceListSharesSheetProps {
  readonly experienceListId: string;
  readonly visible: boolean;
  readonly onClose: () => void;
}

interface FriendListEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
  readonly establishedAt: string;
}

interface FriendsAndRequests {
  readonly friends: readonly FriendListEntry[];
}

export default function ManageExperienceListSharesSheet({
  experienceListId,
  visible,
  onClose,
}: ManageExperienceListSharesSheetProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [newShareRole, setNewShareRole] = useState<ExperienceListShareRole>('viewer');
  const [isSubmittingNewShare, setIsSubmittingNewShare] = useState(false);

  // Shares query
  const sharesQuery = useQuery<readonly ExperienceListShareDTO[]>({
    queryKey: ['experience-list-shares', experienceListId],
    queryFn: () =>
      apiRequest<readonly ExperienceListShareDTO[]>(
        'GET',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/shares`,
      ),
    enabled: visible,
  });

  // Friends query (to add new shares)
  const friendsQuery = useQuery<FriendsAndRequests>({
    queryKey: ['my-friends'],
    queryFn: () => apiRequest<FriendsAndRequests>('GET', '/me/friends'),
    enabled: visible,
  });

  const shares = sharesQuery.data ?? [];
  const existingRecipientIds = new Set(shares.map((s) => s.recipientId));
  const availableFriends = (friendsQuery.data?.friends ?? []).filter(
    (f) => !existingRecipientIds.has(f.userId),
  );

  async function handleToggleRole(share: ExperienceListShareDTO): Promise<void> {
    const nextRole: ExperienceListShareRole = share.role === 'viewer' ? 'editor' : 'viewer';
    setIsUpdating(share.recipientId);
    try {
      await apiRequest(
        'POST',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/shares`,
        {
          recipientId: share.recipientId,
          role: nextRole,
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['experience-list-shares', experienceListId] });
    } catch {
      // Ignore
    } finally {
      setIsUpdating(null);
    }
  }

  async function handleRevoke(recipientId: string): Promise<void> {
    setIsUpdating(recipientId);
    try {
      await apiRequest(
        'DELETE',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/shares/${encodeURIComponent(recipientId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['experience-list-shares', experienceListId] });
    } catch {
      // Ignore
    } finally {
      setIsUpdating(null);
    }
  }

  async function handleAddNewShare(): Promise<void> {
    if (!selectedFriendId || isSubmittingNewShare) return;
    setIsSubmittingNewShare(true);
    try {
      await apiRequest(
        'POST',
        `/me/experience-lists/${encodeURIComponent(experienceListId)}/shares`,
        {
          recipientId: selectedFriendId,
          role: newShareRole,
        },
      );
      setSelectedFriendId(null);
      setNewShareRole('viewer');
      await queryClient.invalidateQueries({ queryKey: ['experience-list-shares', experienceListId] });
    } catch {
      // Ignore
    } finally {
      setIsSubmittingNewShare(false);
    }
  }

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render, which `FlatList`/`VirtualizedList` treats as a changed render
  // function and forces expensive re-render/re-measure work even when the row
  // is otherwise unchanged (see the same fix in `DestinationScreen.tsx`).
  // Placed before the `if (!visible) return null;` early return below so the
  // hook always runs, satisfying React's Rules of Hooks.
  const renderFriend = useCallback(
    ({ item }: { item: FriendListEntry }) => {
      const isSelected = selectedFriendId === item.userId;
      return (
        <Pressable
          onPress={() => setSelectedFriendId(isSelected ? null : item.userId)}
          style={[
            styles.friendChip,
            isSelected && styles.friendChipSelected,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Select friend ${item.displayName}`}
          testID={`experience-share-friend-select-${item.userId}`}
        >
          <Text
            style={[
              styles.friendChipText,
              isSelected && styles.friendChipTextSelected,
            ]}
          >
            {item.displayName}
          </Text>
        </Pressable>
      );
    },
    [selectedFriendId],
  );

  // Same stable-identity fix as `renderFriend` above, for the current-shares
  // `FlatList`.
  const renderShare = useCallback(
    ({ item }: { item: ExperienceListShareDTO }) => {
      const busy = isUpdating === item.recipientId;
      return (
        <View
          style={styles.shareRow}
          testID={`experience-share-row-${item.recipientId}`}
        >
          <View style={styles.shareInfo}>
            <Text style={styles.shareName}>{item.recipientDisplayName}</Text>
            <Text style={styles.shareRoleLabel}>
              {item.role === 'editor' ? 'Can edit items' : 'View only'}
            </Text>
          </View>

          <View style={styles.shareActions}>
            <Pressable
              onPress={() => void handleToggleRole(item)}
              disabled={busy}
              style={[
                styles.roleBadge,
                item.role === 'editor' && styles.roleBadgeEditor,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Toggle role for ${item.recipientDisplayName}, currently ${item.role}`}
              testID={`experience-share-role-toggle-${item.recipientId}`}
            >
              <Text
                style={[
                  styles.roleBadgeText,
                  item.role === 'editor' && styles.roleBadgeTextEditor,
                ]}
              >
                {item.role === 'editor' ? 'Editor' : 'Viewer'}
              </Text>
              <Ionicons
                name="swap-horizontal"
                size={14}
                color={item.role === 'editor' ? '#fff' : theme.color.primary}
              />
            </Pressable>

            <Pressable
              onPress={() => void handleRevoke(item.recipientId)}
              disabled={busy}
              style={styles.revokeBtn}
              accessibilityRole="button"
              accessibilityLabel={`Revoke access for ${item.recipientDisplayName}`}
              testID={`experience-share-revoke-btn-${item.recipientId}`}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.color.danger} />
              ) : (
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={theme.color.danger}
                />
              )}
            </Pressable>
          </View>
        </View>
      );
    },
    [isUpdating, handleToggleRole, handleRevoke],
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID="manage-experience-list-shares-sheet"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Manage Sharing</Text>
              <Text style={styles.subtitle}>
                Control who can view or edit this list
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close manage sharing"
              style={styles.closeBtn}
              testID="close-manage-experience-shares-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Add New Share Section */}
          <View style={styles.addShareSection}>
            <Text style={styles.sectionHeader}>Share with a friend</Text>
            {availableFriends.length === 0 ? (
              <Text style={styles.noFriendsText}>
                No friends available to share with.
              </Text>
            ) : (
              <>
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={availableFriends}
                  keyExtractor={(f) => f.userId}
                  renderItem={renderFriend}
                  contentContainerStyle={styles.friendsList}
                />

                {selectedFriendId ? (
                  <View style={styles.addShareControls}>
                    <View style={styles.roleToggleGroup}>
                      <Pressable
                        onPress={() => setNewShareRole('viewer')}
                        style={[
                          styles.rolePill,
                          newShareRole === 'viewer' && styles.rolePillActive,
                        ]}
                        testID="add-experience-share-role-viewer"
                      >
                        <Text
                          style={[
                            styles.rolePillText,
                            newShareRole === 'viewer' && styles.rolePillTextActive,
                          ]}
                        >
                          Viewer
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setNewShareRole('editor')}
                        style={[
                          styles.rolePill,
                          newShareRole === 'editor' && styles.rolePillActive,
                        ]}
                        testID="add-experience-share-role-editor"
                      >
                        <Text
                          style={[
                            styles.rolePillText,
                            newShareRole === 'editor' && styles.rolePillTextActive,
                          ]}
                        >
                          Editor
                        </Text>
                      </Pressable>
                    </View>

                    <Pressable
                      onPress={() => void handleAddNewShare()}
                      disabled={isSubmittingNewShare}
                      style={[
                        styles.shareSubmitBtn,
                        isSubmittingNewShare && styles.shareSubmitBtnDisabled,
                      ]}
                      testID="add-experience-share-submit-btn"
                    >
                      {isSubmittingNewShare ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.shareSubmitBtnText}>Share</Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>

          {/* Current Shares List */}
          <Text style={[styles.sectionHeader, styles.currentSharesHeader]}>
            People with access ({shares.length})
          </Text>

          {sharesQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.color.primary} testID="manage-experience-shares-loading" />
            </View>
          ) : (
            <FlatList
              data={shares}
              keyExtractor={(item) => item.recipientId}
              renderItem={renderShare}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText} testID="manage-experience-shares-empty">
                    Not shared with anyone yet.
                  </Text>
                </View>
              }
              contentContainerStyle={styles.sharesListContent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  currentSharesHeader: {
    marginTop: theme.spacing.lg,
  },
  addShareSection: {
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  noFriendsText: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    color: theme.color.textSecondary,
    fontSize: 13,
  },
  friendsList: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    gap: 8,
  },
  friendChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
  },
  friendChipSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  friendChipText: {
    fontSize: 13,
    color: theme.color.textPrimary,
    fontWeight: '500',
  },
  friendChipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  addShareControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    marginTop: 8,
  },
  roleToggleGroup: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.sm - 2,
  },
  rolePillActive: {
    backgroundColor: theme.color.primary,
  },
  rolePillText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  rolePillTextActive: {
    color: '#fff',
  },
  shareSubmitBtn: {
    backgroundColor: theme.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
  },
  shareSubmitBtnDisabled: {
    opacity: 0.5,
  },
  shareSubmitBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  loadingWrap: {
    padding: 32,
    alignItems: 'center',
  },
  sharesListContent: {
    paddingVertical: 8,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  shareInfo: {
    flex: 1,
  },
  shareName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  shareRoleLabel: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  shareActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.primary,
    backgroundColor: 'rgba(107, 70, 193, 0.08)',
  },
  roleBadgeEditor: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.primary,
  },
  roleBadgeTextEditor: {
    color: '#fff',
  },
  revokeBtn: {
    padding: 6,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 13,
  },
});
