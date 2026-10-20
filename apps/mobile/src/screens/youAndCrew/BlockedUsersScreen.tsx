// Feature: photo-uploads, Task 13.8 — Blocked Users Screen
//
// Validates: Requirements 17.1, 17.5

import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { BlockedUserDTO } from '@dwt/shared';
import { isAvatarPresetId } from '@dwt/shared';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import { Card, EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { useBlocks, useRemoveBlock } from '../../photos/api';

function formatBlockDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  } catch {
    // fallback
  }
  return iso.slice(0, 10);
}

export default function BlockedUsersScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation();

  const { data: blocks = [], isLoading, isError, refetch } = useBlocks();
  const removeBlockMutation = useRemoveBlock();

  const handleUnblock = (blockId: string) => {
    removeBlockMutation.mutate(blockId);
  };

  return (
    <ScreenContainer>
      <View style={styles.container} testID="blocked-users-screen">
        <GradientHeader
          title="Blocked Users"
          icon="ban"
          compact
          onBack={() => navigation.goBack()}
        />

        <View style={styles.content}>
          {isLoading ? (
            <View style={styles.center} testID="blocked-users-loading">
              <ActivityIndicator size="large" color={t.color.primaryFg} />
            </View>
          ) : isError ? (
            <View style={styles.center} testID="blocked-users-error">
              <Ionicons name="alert-circle-outline" size={40} color={t.color.danger} />
              <Text style={styles.errorText}>Could not load blocked users.</Text>
              <Pressable
                onPress={() => void refetch()}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Retry loading blocked users"
                testID="blocked-users-retry-button"
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : blocks.length === 0 ? (
            <EmptyState
              title="No blocked users"
              body="You have not blocked anyone yet. Blocked guests will appear here."
              testID="blocked-users-empty"
            />
          ) : (
            <FlatList
              data={blocks}
              keyExtractor={(item) => item.blockId}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }: { item: BlockedUserDTO }) => {
                const isAnonymous = !item.displayName;
                const title = item.displayName ?? 'Photo uploader';
                const dateText = formatBlockDate(item.createdAt);
                const isUnblocking =
                  removeBlockMutation.isPending &&
                  removeBlockMutation.variables === item.blockId;

                return (
                  <Card
                    style={styles.blockCard}
                    testID={`blocked-user-row-${item.blockId}`}
                  >
                    <View style={styles.row}>
                      <View style={styles.avatarWrap}>
                        {isAvatarPresetId(item.avatarPreset) ? (
                          renderAvatarPreset(item.avatarPreset, 36)
                        ) : (
                          <View style={styles.avatarPlaceholder}>
                            <Ionicons
                              name={isAnonymous ? 'camera-outline' : 'person-outline'}
                              size={20}
                              color={t.color.textSecondary}
                            />
                          </View>
                        )}
                      </View>

                      <View style={styles.infoWrap}>
                        <Text style={styles.nameText} numberOfLines={1}>
                          {title}
                        </Text>
                        <Text style={styles.dateText}>{dateText}</Text>
                      </View>

                      <Pressable
                        onPress={() => handleUnblock(item.blockId)}
                        disabled={isUnblocking}
                        style={styles.unblockBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Unblock ${title}`}
                        testID={`unblock-btn-${item.blockId}`}
                      >
                        {isUnblocking ? (
                          <ActivityIndicator size="small" color={t.color.primaryFg} />
                        ) : (
                          <Text style={styles.unblockBtnText}>Unblock</Text>
                        )}
                      </Pressable>
                    </View>
                  </Card>
                );
              }}
            />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.sm,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.spacing.xl,
  },
  errorText: {
    ...t.typography.body,
    color: t.color.textSecondary,
    marginVertical: t.spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.sm,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  retryText: {
    ...t.typography.button,
    color: t.color.primaryFg,
  },
  listContent: {
    paddingVertical: t.spacing.sm,
    gap: t.spacing.sm,
  },
  blockCard: {
    padding: t.spacing.md,
    backgroundColor: t.color.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoWrap: {
    flex: 1,
  },
  nameText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  dateText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  unblockBtn: {
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  unblockBtnText: {
    ...t.typography.button,
    fontSize: 13,
    color: t.color.primaryFg,
  },
}));
