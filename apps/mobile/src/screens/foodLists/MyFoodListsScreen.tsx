import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import type { FoodListCollectionDTO, FoodListDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, GradientHeader, ScreenContainer } from '../../theme/components';

export default function MyFoodListsScreen(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'owned' | 'saved'>('owned');

  // Create List Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListVisibility, setNewListVisibility] = useState<'private' | 'public'>('private');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Rename List Modal State
  const [renameTarget, setRenameTarget] = useState<FoodListDTO | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Query collection
  const collectionQuery = useQuery<FoodListCollectionDTO>({
    queryKey: ['food-lists-collection'],
    queryFn: () => apiRequest<FoodListCollectionDTO>('GET', '/me/food-lists/collection'),
  });

  const collection = collectionQuery.data;
  const ownedLists = collection?.owned ?? [];
  const savedLists = collection?.saved ?? [];

  async function handleCreateList(): Promise<void> {
    const trimmed = newListName.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      await apiRequest('POST', '/me/food-lists', {
        name: trimmed,
        visibility: newListVisibility,
      });
      setNewListName('');
      setNewListVisibility('private');
      setCreateError(null);
      setCreateModalVisible(false);
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create list. Please try again.',
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRenameList(): Promise<void> {
    if (!renameTarget || !renameValue.trim() || isRenaming) return;
    setIsRenaming(true);
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(renameTarget.id)}`, {
        name: renameValue.trim(),
      });
      setRenameTarget(null);
      setRenameValue('');
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', renameTarget.id] });
    } catch {
      // Ignore
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleToggleVisibility(list: FoodListDTO): Promise<void> {
    const nextVis = list.visibility === 'public' ? 'private' : 'public';
    try {
      await apiRequest('PATCH', `/me/food-lists/${encodeURIComponent(list.id)}`, {
        visibility: nextVis,
      });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', list.id] });
    } catch {
      // Ignore
    }
  }

  async function handleDeleteList(listId: string): Promise<void> {
    try {
      await apiRequest('DELETE', `/me/food-lists/${encodeURIComponent(listId)}`);
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
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

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="my-food-lists-screen">
        <GradientHeader
          title="Food Lists"
          subtitle="Manage your Disney dish collections"
          compact
          onBack={handleBack}
          right={
            <Pressable
              onPress={() => navigation.navigate('FoodListDiscovery')}
              accessibilityRole="button"
              accessibilityLabel="Discover public food lists"
              style={styles.headerRightBtn}
              testID="my-food-lists-discover-btn"
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
            testID="my-food-lists-tab-owned"
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
            testID="my-food-lists-tab-saved"
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
          <ActivityIndicator color={theme.color.primary} size="large" testID="my-food-lists-loading" />
        </View>
      ) : activeTab === 'owned' ? (
        <View style={styles.tabContent}>
          {/* Create List Button */}
          <Pressable
            onPress={() => {
              setNewListName('');
              setNewListVisibility('private');
              setCreateError(null);
              setCreateModalVisible(true);
            }}
            style={styles.createButton}
            accessibilityRole="button"
            accessibilityLabel="Create a new food list"
            testID="my-food-lists-create-btn"
          >
            <Ionicons name="add-circle" size={22} color="#fff" />
            <Text style={styles.createButtonText}>Create New List</Text>
          </Pressable>

          <FlatList
            data={ownedLists}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Card style={styles.card} testID={`my-food-list-card-${item.id}`}>
                <Pressable
                  onPress={() => navigation.navigate('FoodListDetail', { foodListId: item.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open food list ${item.name}`}
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
                    onPress={() => {
                      setRenameTarget(item);
                      setRenameValue(item.name);
                    }}
                    style={styles.controlBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${item.name}`}
                    testID={`my-food-lists-rename-btn-${item.id}`}
                  >
                    <Ionicons name="pencil-outline" size={16} color={theme.color.textSecondary} />
                    <Text style={styles.controlBtnText}>Rename</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void handleToggleVisibility(item)}
                    style={styles.controlBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Change visibility of ${item.name}, currently ${item.visibility}`}
                    testID={`my-food-lists-visibility-btn-${item.id}`}
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
                    testID={`my-food-lists-delete-btn-${item.id}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={theme.color.danger} />
                    <Text style={[styles.controlBtnText, styles.deleteBtnText]}>Delete</Text>
                  </Pressable>
                </View>
              </Card>
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="restaurant-outline" size={44} color={theme.color.textSecondary} />
                <Text style={styles.emptyText} testID="my-food-lists-owned-empty">
                  You haven&apos;t created any food lists yet.
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
            keyExtractor={(item) => (item.available ? item.id : item.foodListId)}
            renderItem={({ item }) => {
              // Requirement 7a, Task 8.11: Unavailable row degradation
              if (!item.available) {
                return (
                  <View
                    style={styles.unavailableRow}
                    testID={`saved-food-list-unavailable-${item.foodListId}`}
                  >
                    <Ionicons name="alert-circle-outline" size={20} color={theme.color.textSecondary} />
                    <Text style={styles.unavailableRowText}>No longer available</Text>
                  </View>
                );
              }

              return (
                <Pressable
                  onPress={() => navigation.navigate('FoodListDetail', { foodListId: item.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open saved food list ${item.name}`}
                  testID={`saved-food-list-card-${item.id}`}
                >
                  <Card style={styles.savedCard} testID={`saved-food-list-card-inner-${item.id}`}>
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
            }}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="bookmark-outline" size={44} color={theme.color.textSecondary} />
                <Text style={styles.emptyText} testID="my-food-lists-saved-empty">
                  No saved lists yet.
                </Text>
              </View>
            }
            contentContainerStyle={styles.listContent}
          />
        </View>
      )}

      {/* Create List Modal */}
      <Modal
        visible={createModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setCreateModalVisible(false);
          setCreateError(null);
        }}
        testID="create-food-list-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Create Food List</Text>
            <TextInput
              value={newListName}
              onChangeText={(text) => {
                setNewListName(text);
                if (createError) setCreateError(null);
              }}
              placeholder="e.g. Best Epcot Snacks"
              placeholderTextColor={theme.color.textSecondary}
              style={styles.modalInput}
              autoFocus
              testID="new-food-list-name-input"
            />

            <View style={styles.visibilityToggleRow}>
              <Text style={styles.visibilityLabel}>Visibility:</Text>
              <View style={styles.visToggleGroup}>
                <Pressable
                  onPress={() => setNewListVisibility('private')}
                  style={[
                    styles.visPill,
                    newListVisibility === 'private' && styles.visPillActive,
                  ]}
                  testID="new-food-list-visibility-private"
                >
                  <Text
                    style={[
                      styles.visPillText,
                      newListVisibility === 'private' && styles.visPillTextActive,
                    ]}
                  >
                    Private
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setNewListVisibility('public')}
                  style={[
                    styles.visPill,
                    newListVisibility === 'public' && styles.visPillActive,
                  ]}
                  testID="new-food-list-visibility-public"
                >
                  <Text
                    style={[
                      styles.visPillText,
                      newListVisibility === 'public' && styles.visPillTextActive,
                    ]}
                  >
                    Public
                  </Text>
                </Pressable>
              </View>
            </View>

            {createError ? (
              <Text style={styles.modalErrorText} testID="create-food-list-error">
                {createError}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setCreateModalVisible(false);
                  setCreateError(null);
                }}
                style={styles.modalCancelBtn}
                testID="cancel-create-food-list-btn"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleCreateList()}
                disabled={!newListName.trim() || isCreating}
                style={[
                  styles.modalSubmitBtn,
                  (!newListName.trim() || isCreating) && styles.modalSubmitBtnDisabled,
                ]}
                testID="submit-create-food-list-btn"
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>Create</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename List Modal */}
      <Modal
        visible={Boolean(renameTarget)}
        animationType="fade"
        transparent
        onRequestClose={() => setRenameTarget(null)}
        testID="rename-food-list-modal"
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
              testID="rename-food-list-input"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setRenameTarget(null)}
                style={styles.modalCancelBtn}
                testID="cancel-rename-food-list-btn"
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
                testID="submit-rename-food-list-btn"
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
  visibilityToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visibilityLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  visToggleGroup: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  visPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.sm - 2,
  },
  visPillActive: {
    backgroundColor: theme.color.primary,
  },
  visPillText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  visPillTextActive: {
    color: '#fff',
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
