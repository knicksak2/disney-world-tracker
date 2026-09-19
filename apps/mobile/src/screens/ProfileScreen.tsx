/**
 * ProfileScreen — User profile presentation and identity management.
 * (Task 10.1, Requirements 7.3, 7.4, design.md Section 6)
 *
 * Trimmed to the identity block (avatar presentation & picker, display-name editor).
 * Personal stats, food history, food lists, pins, and notification center entry points
 * have been retired from this screen and relocated to Collection and the global header.
 *
 * Exports `ProfileIdentityBlock` for composition inside `YouAndCrewScreen`.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { displayNameSchema, type ProfileDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import { theme } from '../theme/theme';
import {
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
} from '../theme/components';
import { renderAvatarPreset } from '../avatars/AvatarPresets';
import AvatarPicker from './AvatarPicker';
import PushNotificationPreferenceControl from './PushNotificationPreferenceControl';
import ChangePasswordControl from './ChangePasswordControl';
import { invalidatePushRegistration } from '../hooks/usePushRegistration';
import { useSessionStore } from '../state/sessionStore';

// ---------------------------------------------------------------------------
// Route & Query types
// ---------------------------------------------------------------------------

type ProfileRouteParams = {
  readonly userId?: string;
};

type ProfileRouteProp = RouteProp<{ Profile: ProfileRouteParams }, 'Profile'>;

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

export type ProfileQueryResult =
  | { readonly kind: 'ok'; readonly profile: ProfileDTO }
  | { readonly kind: 'forbidden' };

const DISPLAY_NAME_INVALID_MESSAGE =
  'Display name must be 1-50 characters with at least one non-whitespace character.';

// ---------------------------------------------------------------------------
// ProfileIdentityBlock — Reusable Identity Component (Task 10.1, Req 7.4)
// ---------------------------------------------------------------------------

export interface ProfileIdentityBlockProps {
  readonly profile: ProfileDTO;
  readonly isSelf: boolean;
  readonly onAvatarChanged?: (profile: ProfileDTO) => void;
  readonly onProfileUpdated?: (profile: ProfileDTO) => void;
}

export function ProfileIdentityBlock({
  profile,
  isSelf,
  onAvatarChanged,
  onProfileUpdated,
}: ProfileIdentityBlockProps): JSX.Element {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.displayName);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(profile.displayName);
    }
  }, [profile.displayName, isEditing]);

  const saveNameMutation = useMutation<ProfileDTO, ApiError, string>({
    mutationFn: (displayName: string) =>
      apiRequest<ProfileDTO>('PATCH', '/me/profile', { displayName }),
    onSuccess: (updated) => {
      const next: ProfileQueryResult = { kind: 'ok', profile: updated };
      queryClient.setQueryData<ProfileQueryResult>(
        ['profile', updated.userId],
        next,
      );
      queryClient.setQueryData<MeResponse>(['me'], (prev) =>
        prev
          ? {
              ...prev,
              profile: {
                ...prev.profile,
                displayName: updated.displayName,
              },
            }
          : prev,
      );
      setIsEditing(false);
      setNameError(null);
      onProfileUpdated?.(updated);
    },
    onError: (err) => {
      if (err.code === 'display_name_invalid') {
        setNameError(DISPLAY_NAME_INVALID_MESSAGE);
        return;
      }
      setNameError(err.message);
    },
  });

  const handleSave = () => {
    const parsed = displayNameSchema.safeParse(draftName);
    if (!parsed.success) {
      setNameError(DISPLAY_NAME_INVALID_MESSAGE);
      return;
    }
    const normalized = parsed.data;
    if (normalized === profile.displayName) {
      setIsEditing(false);
      setNameError(null);
      return;
    }
    saveNameMutation.mutate(normalized);
  };

  const handleAvatarChanged = (updated: ProfileDTO) => {
    const next: ProfileQueryResult = { kind: 'ok', profile: updated };
    queryClient.setQueryData<ProfileQueryResult>(
      ['profile', updated.userId],
      next,
    );
    queryClient.setQueryData<MeResponse>(['me'], (prev) =>
      prev
        ? {
            ...prev,
            profile: {
              ...prev.profile,
              avatarPreset: updated.avatarPreset,
            },
          }
        : prev,
    );
    onAvatarChanged?.(updated);
  };

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  return (
    <Card style={styles.identityCard} testID="profile-identity-card">
      <View style={styles.cardHeaderRow}>
        <Text style={styles.identityEyebrow}>My Identity</Text>
      </View>

      <View style={styles.identityRow}>
        {/* Left: Avatar (56px) with optional CHANGE pill badge */}
        {isSelf ? (
          <Pressable
            onPress={() => setAvatarPickerOpen((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel="Change avatar"
            testID="change-avatar-button"
            style={styles.avatarPressable}
          >
            <View style={styles.avatarRing}>
              {profile.avatarPreset !== null ? (
                <View
                  style={styles.avatar}
                  accessibilityLabel={`${profile.displayName}'s avatar`}
                  testID="profile-avatar"
                >
                  {renderAvatarPreset(profile.avatarPreset, 56)}
                </View>
              ) : (
                <View
                  style={[styles.avatar, styles.avatarPlaceholder]}
                  testID="profile-avatar-placeholder"
                >
                  <Text style={styles.avatarPlaceholderText}>
                    {profile.displayName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.changeBadge}>
              <Text style={styles.changeBadgeText}>CHANGE</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.avatarPressable}>
            <View style={styles.avatarRing}>
              {profile.avatarPreset !== null ? (
                <View
                  style={styles.avatar}
                  accessibilityLabel={`${profile.displayName}'s avatar`}
                  testID="profile-avatar"
                >
                  {renderAvatarPreset(profile.avatarPreset, 56)}
                </View>
              ) : (
                <View
                  style={[styles.avatar, styles.avatarPlaceholder]}
                  testID="profile-avatar-placeholder"
                >
                  <Text style={styles.avatarPlaceholderText}>
                    {profile.displayName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Right: Display Name & inline editing */}
        <View style={styles.identityDetails}>
          <Text style={styles.fieldLabel}>Display Name</Text>

          {isSelf && isEditing ? (
            <View style={styles.editorWrap}>
              <View style={styles.inlineEditRow}>
                <TextInput
                  value={draftName}
                  onChangeText={(val) => {
                    setDraftName(val);
                    if (nameError !== null) setNameError(null);
                  }}
                  placeholder="Display name"
                  placeholderTextColor={theme.color.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={50}
                  editable={!saveNameMutation.isPending}
                  style={styles.inlineInput}
                  accessibilityLabel="Display name"
                  testID="edit-display-name-input"
                />
                <Pressable
                  onPress={handleSave}
                  disabled={saveNameMutation.isPending}
                  style={({ pressed }) => [
                    styles.inlineSaveBtn,
                    saveNameMutation.isPending && styles.btnDisabled,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save display name"
                  testID="save-display-name-button"
                >
                  <Text style={styles.inlineSaveBtnText}>
                    {saveNameMutation.isPending ? '...' : 'Save'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDraftName(profile.displayName);
                    setNameError(null);
                    setIsEditing(false);
                  }}
                  disabled={saveNameMutation.isPending}
                  style={({ pressed }) => [
                    styles.inlineCancelBtn,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing display name"
                  testID="cancel-display-name-button"
                >
                  <Ionicons name="close" size={18} color={theme.color.textSecondary} />
                </Pressable>
              </View>
              {nameError !== null ? (
                <Text style={styles.inlineError} accessibilityRole="alert">
                  {nameError}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.nameDisplayRow}>
              <Text
                style={styles.displayName}
                testID="profile-display-name"
                numberOfLines={1}
              >
                {profile.displayName}
              </Text>
              {isSelf ? (
                <Pressable
                  onPress={() => {
                    setDraftName(profile.displayName);
                    setNameError(null);
                    setIsEditing(true);
                  }}
                  style={({ pressed }) => [
                    styles.editNameBtn,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Edit display name"
                  testID="edit-display-name-button"
                >
                  <Ionicons name="create-outline" size={14} color={theme.color.primary} />
                  <Text style={styles.editNameBtnText}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>

      {/* Inline Avatar Picker Grid (toggleable) */}
      {isSelf ? (
        <AvatarPicker
          currentPreset={profile.avatarPreset}
          onChanged={handleAvatarChanged}
          isOpen={avatarPickerOpen}
          onOpenChange={setAvatarPickerOpen}
          showDefaultTrigger={false}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Screen Component
// ---------------------------------------------------------------------------

export default function ProfileScreen(): JSX.Element {
  const route = useRoute<ProfileRouteProp>();
  const targetUserIdParam = route.params?.userId;

  const queryClient = useQueryClient();
  const clearToken = useSessionStore((state) => state.clearToken);

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
  });

  const ownUserId = meQuery.data?.user.id;
  const isSelf =
    targetUserIdParam === undefined ||
    (ownUserId !== undefined && targetUserIdParam === ownUserId);

  const targetUserId = isSelf ? ownUserId : targetUserIdParam;

  const profileQuery = useQuery<ProfileQueryResult, ApiError>({
    queryKey: ['profile', targetUserId ?? null],
    enabled: targetUserId !== undefined,
    queryFn: async () => {
      try {
        const profile = await apiRequest<ProfileDTO>(
          'GET',
          `/users/${encodeURIComponent(targetUserId as string)}/profile`,
        );
        return { kind: 'ok' as const, profile };
      } catch (err) {
        if (err instanceof ApiError && err.code === 'profile_forbidden') {
          return { kind: 'forbidden' as const };
        }
        throw err;
      }
    },
    retry: false,
  });

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

  const stillResolvingSelf = isSelf && ownUserId === undefined;
  if (
    (stillResolvingSelf && meQuery.isLoading) ||
    profileQuery.isLoading ||
    (profileQuery.fetchStatus === 'fetching' && profileQuery.data === undefined)
  ) {
    return (
      <ScreenContainer>
        <View style={styles.centered} accessibilityRole="progressbar">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  if (stillResolvingSelf && meQuery.isError) {
    return (
      <ScreenContainer>
        <GradientHeader title="Profile" icon="person-circle" compact />
        <View style={styles.centered}>
          <EmptyState
            icon="alert-circle-outline"
            title="We couldn't load your profile"
            body="Please try again later."
          />
        </View>
      </ScreenContainer>
    );
  }

  const result = profileQuery.data;

  if (result?.kind === 'forbidden') {
    return (
      <ScreenContainer>
        <GradientHeader title="Profile" icon="person-circle" compact />
        <View style={styles.centered}>
          <EmptyState
            icon="lock-closed-outline"
            title="Profile unavailable"
            body="You don't have permission to view this profile."
          />
        </View>
      </ScreenContainer>
    );
  }

  if (result?.kind !== 'ok') {
    return (
      <ScreenContainer>
        <GradientHeader title="Profile" icon="person-circle" compact />
        <View style={styles.centered}>
          <EmptyState
            icon="alert-circle-outline"
            title="We couldn't load this profile"
            body="Please try again later."
          />
        </View>
      </ScreenContainer>
    );
  }

  const profile = result.profile;

  return (
    <ScreenContainer>
      <GradientHeader
        title={isSelf ? 'Your Profile' : profile.displayName}
        {...(isSelf ? { subtitle: 'Manage your magical identity.' } : {})}
        icon="person-circle"
      />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <ProfileIdentityBlock
          profile={profile}
          isSelf={isSelf}
        />

        {isSelf ? (
          <>
            <Card style={styles.securityCard}>
              <Text style={styles.statLabel}>Notifications</Text>
              <PushNotificationPreferenceControl />
            </Card>

            <Card style={styles.securityCard}>
              <Text style={styles.statLabel}>Account security</Text>
              <ChangePasswordControl />
            </Card>

            <View style={styles.logoutBlock}>
              <SecondaryButton
                label={logoutMutation.isPending ? 'Logging out\u2026' : 'Log out'}
                icon="log-out-outline"
                tone="danger"
                onPress={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  body: {
    flexGrow: 1,
    paddingHorizontal: theme.spacing.xl,
    marginTop: -theme.layout.headerOverlap,
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  identityCard: {
    padding: 14,
    gap: theme.spacing.sm,
  },
  cardHeaderRow: {
    marginBottom: 2,
  },
  identityEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarPressable: {
    position: 'relative',
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2.5,
    borderColor: '#ffd54f',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
    overflow: 'hidden',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.color.surfaceAlt,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderText: {
    ...theme.typography.title,
    color: theme.color.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  changeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#ffd54f',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  changeBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#311b92',
    letterSpacing: 0.5,
  },
  identityDetails: {
    flex: 1,
    gap: 2,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  nameDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  displayName: {
    ...theme.typography.title,
    fontSize: 16,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  editNameBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  editNameBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.primary,
  },
  editorWrap: {
    gap: 4,
  },
  inlineEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  inlineSaveBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineSaveBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  inlineCancelBtn: {
    padding: 4,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  inlineError: {
    ...theme.typography.meta,
    color: theme.color.danger,
    fontSize: 11,
  },
  securityCard: {
    gap: theme.spacing.md,
  },
  statLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
  },
  logoutBlock: {
    marginTop: theme.spacing.sm,
  },
});
