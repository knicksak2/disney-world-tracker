/**
 * YouAndCrewScreen — Standalone stack wrapper around `YouAndCrewContent`.
 * (Task 10.2, Requirements 7.1, 7.2, 7.3, 7.4, design.md Section 6)
 */

import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { ProfileDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { makeStyles } from '../../theme/makeStyles';
import { withAlpha } from '../../theme/theme';
import { useAppTheme } from '../../theme/useAppTheme';
import { GradientHeader, ScreenContainer } from '../../theme/components';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { YouAndCrewContent } from './YouAndCrewContent';

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

export default function YouAndCrewScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<NavigationProp>();

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
        right={
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityHint="Opens app preferences, account security, help and legal"
            testID="header-settings-button"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerSettingsBtn,
              pressed && styles.headerSettingsBtnPressed,
            ]}
          >
            <Ionicons name="settings-outline" size={20} color={t.color.textOnPrimary} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false}>
        <YouAndCrewContent />
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  headerSettingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(t.color.textOnPrimary, 0.16),
  },
  headerSettingsBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
}));
