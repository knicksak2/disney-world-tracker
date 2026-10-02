import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExperienceListCollectionDTO, ExperienceListDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, GradientHeader, ScreenContainer } from '../../theme/components';
import CreateExperienceListModal from './CreateExperienceListModal';

export default function MyExperienceListsScreen(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'owned' | 'saved'>('owned');

  // Create List Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);

  // Rename List Modal State
  const [renameTarget, setRenameTarget] = useState<ExperienceListDTO | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Query collection
  const collectionQuery = useQuery<ExperienceListCollectionDTO>({
    queryKey: ['experience-lists-collection'],
    queryFn: () =>
      apiRequest<ExperienceListCollectionDTO>('GET', '/me/experience-lists/collection'),
  });

  const collection = collectionQuery.data;
  const ownedLists = collection?.owned ?? [];
  const savedLists = collection?.saved ?? [];

  async function invalidateOwnedExperienceLists(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
  }

  async function handleTogglePinned(list: ExperienceListDTO): Promise<void> {
    if (list.pinnedAt === null) {
      const pinnedCount = ownedLists.filter((l) => l.pinnedAt !== null).length;
      if (pinnedCount >= 4) {
        Alert.alert(
          'Pin Limit Reached',
          'You can pin up to 4 lists to your dashboard. Unpin a list first to pin this one.',
        );
        return;
      }
    }
    try {
      await apiRequest('PATCH', `/me/experience-lists/${encodeURIComponent(list.id)}`, {
        pinned: list.pinnedAt === null,
      });
      await invalidateOwnedExperienceLists();
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', list.id] });
    } catch {
      // Ignore
    }
  }

  async function handleRenameList(): Promise<void> {
    if (!renameTarget || !renameValue.trim() || isRenaming) return;
    setIsRenaming(true);
    try {
      await apiRequest('PATCH', `/me/experience-lists/${encodeURIComponent(renameTarget.id)}`, {
        name: renameValue.trim(),
      });
      setRenameTarget(null);
      setRenameValue('');
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
      await queryClient.invalidateQueries({
        queryKey: ['experience-list-detail', renameTarget.id],
      });
    } catch {
      // Ignore
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleToggleVisibility(list: ExperienceListDTO): Promise<void> {
    const nextVis = list.visibility === 'public' ? 'private' : 'public';
    try {
      await apiRequest('PATCH', `/me/experience-lists/${encodeURIComponent(list.id)}`, {
        visibility: nextVis,
      });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', list.id] });
    } catch {
      // Ignore
    }
  }

  async function handleDeleteList(listId: string): Promise<void> {
    try {
      await apiRequest('DELETE', `/me/experience-lists/${encodeURIComponent(listId)}`);
      await invalidateOwnedExperienceLists();
    } catch {
      // Ignore
    }
  }

  function handleBack(): void {
    if (typeof navigation.canGoBack === 'function' && !navigation.canGoBack()) {
      navigation.navigate('MainTabs');
      return;
    }
    navigation.goBack();
  }

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render, which `FlatList`/`VirtualizedList` treats as a changed render
  // function and forces expensive re-render/re-measure work even when the row
  // is otherwise unchanged (see the same fix in `MyFoodListsScreen.tsx`).
  const renderOwnedList = useCallback(
    ({ item }: { item: ExperienceListDTO }) => (
      <Card style={styles.card} testID={`experience-list-card-${item.id}`}>
        <Pressable
          onPress={() => navigation.navigate('ExperienceListDetail', { experienceListId: item.id })}
          accessibilityRole="button"
          accessibilityLabel={`Open experience list ${item.name}`}
          style={styles.cardPressable}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Badge
              label={item.visibility === 'public' ? 'Public' : 'Private'}
              color={item.visibility === 'public' ? theme.color.primary : theme.color.textSecondary}
            />
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.cardMetaText}>{item.itemCount} items</Text>
            <View style={styles.likeCountBadge}>
              <Ionicons name="heart" size={14} color={theme.color.danger} />
              <Text style={styles.likeCountText}>{item.likeCount}</Text>
            </View>
          </View>
        </Pressable>

        {/* Card Controls */}
        <View style={styles.cardControls}>
          <Pressable
            onPress={() => void handleTogglePinned(item)}
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel={
              item.pinnedAt !== null ? `Unpin ${item.name}` : `Pin ${item.name}`
            }
            testID={`my-experience-lists-pin-btn-${item.id}`}
          >
            <Ionicons
              name={item.pinnedAt !== null ? 'pin' : 'pin-outline'}
              size={16}
              color={item.pinnedAt !== null ? theme.color.primary : theme.color.textSecondary}
            />
            <Text style={styles.controlBtnText}>{item.pinnedAt !== null ? 'Pinned' : 'Pin'}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setRenameTarget(item);
              setRenameValue(item.name);
            }}
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${item.name}`}
            testID={`my-experience-lists-rename-btn-${item.id}`}
          >
            <Ionicons name="pencil-outline" size={16} color={theme.color.textSecondary} />
            <Text style={styles.controlBtnText}>Rename</Text>
          </Pressable>

          <Pressable
            onPress={() => void handleToggleVisibility(item)}
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel={`Change visibility of ${item.name}, currently ${item.visibility}`}
            testID={`my-experience-lists-visibility-btn-${item.id}`}
          >
            <Ionicons
              name={item.visibility === 'public' ? 'globe-outline' : 'lock-closed-outline'}
              size={16}
              color={theme.color.textSecondary}
            />
            <Text style={styles.controlBtnText}>
              Make {item.visibility === 'public' ? 'Private' : 'Public'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void handleDeleteList(item.id)}
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.name}`}
            testID={`my-experience-lists-delete-btn-${item.id}`}
          >
            <Ionicons name="trash-outline" size={16} color={theme.color.danger} />
            <Text style={[styles.controlBtnText, styles.deleteBtnText]}>Delete</Text>
          </Pressable>
        </View>
      </Card>
    ),
    [navigation, handleTogglePinned, handleToggleVisibility, handleDeleteList],
  );

  // Same stable-identity fix as `renderOwnedList` above, for the saved-lists
  // `FlatList`. Preserves the `!item.available` unavailable-row degradation
  // branch exactly (note the discriminated field here is `experienceListId`,
  // not `foodListId`, per `ExperienceListCollectionDTO`'s `saved` shape).
  const renderSavedList = useCallback(
    ({ item }: { item: ExperienceListCollectionDTO['saved'][number] }) => {
      if (!item.available) {
        return (
          <View
            style={styles.unavailableRow}
            testID={`saved-experience-list-unavailable-${item.experienceListId}`}
          >
            <Ionicons name="alert-circle-outline" size={20} color={theme.color.textSecondary} />
            <Text style={styles.unavailableRowText}>No longer available</Text>
          </View>
        );
      }

      return (
        <Pressable
          onPress={() => navigation.navigate('ExperienceListDetail', { experienceListId: item.id })}
          accessibilityRole="button"
          accessibilityLabel={`Open saved experience list ${item.name}`}
          testID={`saved-experience-list-card-${item.id}`}
        >
          <Card style={styles.savedCard} testID={`saved-experience-list-card-inner-${item.id}`}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <View style={styles.likeCountBadge}>
                <Ionicons name="heart" size={14} color={theme.color.danger} />
                <Text style={styles.likeCountText}>{item.likeCount}</Text>
              </View>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.cardMetaText}>by {item.ownerDisplayName}</Text>
              <Text style={styles.cardMetaText}>{item.itemCount} items</Text>
            </View>
          </Card>
        </Pressable>
      );
    },
    [navigation],
  );

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="my-experience-lists-screen">
        <GradientHeader
          title="Experience Lists"
          subtitle="Manage your ride, show, and experience collections"
          compact
          onBack={handleBack}
          right={
            <Pressable
              onPress={() => navigation.navigate('ExperienceListDiscovery')}
              accessibilityRole="button"
              accessibilityLabel="Discover public experience lists"
              style={styles.headerRightBtn}
              testID="my-experience-lists-discover-btn"
            >
              <Ionicons name="compass-outline" size={20} color="#fff" />
              <Text style={styles.headerRightBtnText}>Discover</Text>
            </Pressable>
          }
        />

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <View style={styles.tabsRow}>
          <Pressable
            onPress={() => setActiveTab('owned')}
            style={[styles.tab, activeTab === 'owned' && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'owned' }}
            accessibilityLabel={`My lists tab (${ownedLists.length})`}
            testID="my-experience-lists-tab-owned"
          >
            <Text style={[styles.tabText, activeTab === 'owned' && styles.tabTextActive]}>
              My Lists ({ownedLists.length})
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('saved')}
            style={[styles.tab, activeTab === 'saved' && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'saved' }}
            accessibilityLabel={`Saved lists tab (${savedLists.length})`}
            testID="my-experience-lists-tab-saved"
          >
            <Text style={[styles.tabText, activeTab === 'saved' && styles.tabTextActive]}>
              Saved ({savedLists.length})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content */}
      {collectionQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator
            color={theme.color.primary}
            size="large"
            testID="my-experience-lists-loading"
          />
        </View>
      ) : activeTab === 'owned' ? (
        <View style={styles.tabContent}>
          {/* Create List Button */}
          <Pressable
            onPress={() => setCreateModalVisible(true)}
            style={styles.createButton}
            accessibilityRole="button"
            accessibilityLabel="Create a new experience list"
            testID="my-experience-lists-create-btn"
          >
            <Ionicons name="add-circle" size={22} color="#fff" />
            <Text style={styles.createButtonText}>Create New List</Text>
          </Pressable>

          <FlatList
            data={ownedLists}
            keyExtractor={(item) => item.id}
            renderItem={renderOwnedList}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="sparkles-outline" size={44} color={theme.color.textSecondary} />
                <Text style={styles.emptyText} testID="my-experience-lists-owned-empty">
                  You haven&apos;t created any experience lists yet.
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        </View>
      ) : (
        <View style={styles.tabContent}>
          <FlatList
            data={savedLists}
            keyExtractor={(item) => (item.available ? item.id : item.experienceListId)}
            renderItem={renderSavedList}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="bookmark-outline" size={44} color={theme.color.textSecondary} />
                <Text style={styles.emptyText} testID="my-experience-lists-saved-empty">
                  No saved lists yet.
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}

      {/* Create List Modal (extracted; shared with CollectionScreen.tsx's "+ New" action) */}
      <CreateExperienceListModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={() => {
          setCreateModalVisible(false);
          void invalidateOwnedExperienceLists();
        }}
      />

      {/* Rename List Modal */}
      <Modal
        visible={Boolean(renameTarget)}
        animationType="fade"
        transparent
        onRequestClose={() => setRenameTarget(null)}
        testID="rename-experience-list-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Rename List</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="List name..."
              placeholderTextColor={theme.color.textSecondary}
              style={styles.modalInput}
              autoFocus
              testID="rename-experience-list-input"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setRenameTarget(null)}
                style={styles.modalCancelBtn}
                testID="cancel-rename-experience-list-btn"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleRenameList()}
                disabled={!renameValue.trim() || isRenaming}
                style={[
                  styles.modalSubmitBtn,
                  (!renameValue.trim() || isRenaming) && styles.modalSubmitBtnDisabled,
                ]}
                testID="submit-rename-experience-list-btn"
              >
                {isRenaming ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
        </Modal>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRightBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  headerRightBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  tabsContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
  },
  tabActive: {
    backgroundColor: theme.color.primary,
    ...theme.shadow.card,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  tabTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  tabContent: {
    flex: 1,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.color.primary,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  savedCard: {
    padding: theme.spacing.md,
    gap: 8,
  },
  cardPressable: {
    padding: theme.spacing.md,
    gap: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.color.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardMetaText: {
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  likeCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  likeCountText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  cardControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
  },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  controlBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  deleteBtnText: {
    color: theme.color.danger,
  },
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    opacity: 0.7,
  },
  unavailableRowText: {
    color: theme.color.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 12,
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 15,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: theme.color.surface,
    width: '100%',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  modalInput: {
    backgroundColor: theme.color.background,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  modalErrorText: {
    color: theme.color.danger,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    marginBottom: 4,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  modalSubmitBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: theme.radius.md,
  },
  modalSubmitBtnDisabled: {
    opacity: 0.5,
  },
  modalSubmitText: {
    color: '#fff',
    fontWeight: '700',
  },
});
