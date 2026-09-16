// Feature: food-item-logging, Task 7.4 & 7.5 — Food Item Log History Sheet
//
// Validates: Requirements 4.1, 4.3, 4.4, 5.5, 5.6, 5.7

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { FoodItemDTO, FoodItemLogDTO, FoodItemLogHistoryDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card } from '../../theme/components';

export interface FoodItemLogHistorySheetProps {
  /** The food item whose history is being viewed. */
  readonly foodItem: FoodItemDTO | null;
  /** Whether the modal sheet is visible. */
  readonly visible: boolean;
  /** Dismiss the sheet. */
  readonly onClose: () => void;
  /** Optional callback after a log is deleted. */
  readonly onLogDeleted?: () => void;
}

export default function FoodItemLogHistorySheet({
  foodItem,
  visible,
  onClose,
  onLogDeleted,
}: FoodItemLogHistorySheetProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const foodItemId = foodItem?.id;

  const historyQuery = useQuery<FoodItemLogHistoryDTO>({
    queryKey: ['food-item-logs', foodItemId],
    queryFn: () =>
      apiRequest<FoodItemLogHistoryDTO>(
        'GET',
        `/me/food-items/${encodeURIComponent(foodItemId!)}/logs`,
      ),
    enabled: visible && Boolean(foodItemId),
  });

  if (!visible || !foodItem) {
    return null;
  }

  async function handleDelete(logId: string): Promise<void> {
    if (deletingId !== null) return;
    setDeletingId(logId);
    setDeleteError(null);

    try {
      await apiRequest<void>(
        'DELETE',
        `/me/food-items/${encodeURIComponent(foodItemId!)}/logs/${encodeURIComponent(logId)}`,
      );

      // Invalidate queries per Requirement 5.4
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', foodItemId],
      });
      if (foodItem?.experienceId) {
        await queryClient.invalidateQueries({
          queryKey: ['experience-food-items', foodItem.experienceId],
        });
      }
      if (foodItem?.locationId) {
        await queryClient.invalidateQueries({
          queryKey: ['location-food-items', foodItem.locationId],
        });
      }

      onLogDeleted?.();
    } catch {
      setDeleteError('Could not delete log entry. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  const logs = historyQuery.data?.logs ?? [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID="food-item-log-history-sheet"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title} numberOfLines={1}>
                {foodItem.name}
              </Text>
              <Text style={styles.subtitle}>Visit History</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close visit history"
              style={styles.closeBtn}
              testID="close-food-item-history-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Not currently on menu badge (Requirement 5.7) */}
          {!foodItem.currentlyOnMenu && (
            <View style={styles.badgeRow}>
              <Badge
                label="Not currently on menu"
                color={theme.color.textSecondary}
                testID="food-item-history-not-on-menu"
              />
            </View>
          )}

          {deleteError && (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>{deleteError}</Text>
            </View>
          )}

          {/* Content */}
          <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
            {historyQuery.isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator
                  color={theme.color.primary}
                  testID="food-item-history-loading"
                  accessibilityLabel="Loading visit history"
                />
              </View>
            ) : historyQuery.isError ? (
              <Text style={styles.errorText}>Could not load history.</Text>
            ) : logs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText} testID="food-item-history-empty">
                  No logs yet.
                </Text>
              </View>
            ) : (
              logs.map((log: FoodItemLogDTO) => (
                <Card key={log.id} style={styles.logCard} testID={`food-item-log-card-${log.id}`}>
                  <View style={styles.logHeader}>
                    <View style={styles.logHeaderLeft}>
                      <Text style={styles.logDate}>{log.visitedOn}</Text>
                      {log.rating !== null && (
                        <View style={styles.ratingBadge}>
                          <Ionicons name="star" size={14} color={theme.color.accent} />
                          <Text style={styles.ratingText}>{log.rating}/10</Text>
                        </View>
                      )}
                    </View>
                    <Pressable
                      onPress={() => void handleDelete(log.id)}
                      disabled={deletingId === log.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete log from ${log.visitedOn}`}
                      style={styles.deleteBtn}
                      testID={`food-item-delete-log-${log.id}`}
                    >
                      {deletingId === log.id ? (
                        <ActivityIndicator size="small" color={theme.color.danger} />
                      ) : (
                        <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                      )}
                    </Pressable>
                  </View>
                  {log.note && log.note.trim().length > 0 ? (
                    <Text style={styles.logNote}>{log.note}</Text>
                  ) : null}
                </Card>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 12,
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
  badgeRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  scroll: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  loadingWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 15,
  },
  errorWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
  logCard: {
    marginBottom: 10,
    padding: 12,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logDate: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  deleteBtn: {
    padding: 6,
  },
  logNote: {
    marginTop: 8,
    fontSize: 13,
    color: theme.color.textSecondary,
    lineHeight: 18,
  },
});
