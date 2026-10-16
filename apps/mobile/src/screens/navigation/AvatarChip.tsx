/**
 * AvatarChip component for landing screen headers.
 * (Requirements 2.2, 7.1, 7.2, design.md Section 12)
 *
 * Extracts avatar-or-placeholder rendering logic unchanged from ProfileTabIcon.
 * Reads /me via ['me'] query key, navigates to YouAndCrew on tap.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { isAvatarPresetId } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { renderAvatarPreset } from '../../avatars/AvatarPresets';
import { makeStyles } from '../../theme/makeStyles';
import { withAlpha } from '../../theme/theme';
import { useAppTheme } from '../../theme/useAppTheme';
import { AVATAR_PILL } from './AvatarChip.palette';

interface MeResponse {
  readonly user: { readonly id: string; readonly email: string };
  readonly profile: {
    readonly displayName: string;
    readonly avatarPreset?: string | null;
  };
}

export interface AvatarChipProps {
  readonly size?: number;
  readonly tintColor?: string;
  readonly testID?: string;
  readonly variant?: 'icon' | 'pill';
}

export function AvatarChip({
  size = 30,
  tintColor: tintColorProp,
  testID = 'avatar-chip',
  variant = 'icon',
}: AvatarChipProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  // Default tint: white on the header gradient (textOnPrimary).
  const tintColor = tintColorProp ?? t.color.textOnPrimary;
  const navigation = useNavigation<any>();
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
  });

  const profile = meQuery.data?.profile;
  const preset = profile?.avatarPreset ?? null;
  const initial = (profile?.displayName?.trim()?.[0] || 'Y').toUpperCase();

  const handlePress = () => {
    navigation.navigate('YouAndCrew');
  };

  if (variant === 'pill') {
    return (
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="You and Crew"
        testID={testID}
        style={({ pressed }) => [
          styles.pillContainer,
          pressed && styles.pressed,
        ]}
        hitSlop={6}
      >
        <View style={styles.pillCircle} testID={`${testID}-circle`}>
          {isAvatarPresetId(preset) ? (
            renderAvatarPreset(preset, 24)
          ) : (
            <Text style={styles.pillInitial}>{initial}</Text>
          )}
        </View>
        <Text style={styles.pillLabel}>You & Crew</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="You and Crew"
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
      hitSlop={8}
    >
      {isAvatarPresetId(preset) ? (
        <View
          style={[
            styles.avatarBorder,
            {
              width: size + 4,
              height: size + 4,
              borderRadius: (size + 4) / 2,
              borderColor: tintColor,
            },
          ]}
          testID="avatar-chip-preset"
        >
          {renderAvatarPreset(preset, size)}
        </View>
      ) : (
        <Ionicons
          name="person-circle-outline"
          size={size + 2}
          color={tintColor}
          testID="avatar-chip-placeholder"
        />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  avatarBorder: {
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Neutral white veil on the header gradient (rule 5, exempt).
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: 1.5,
    borderColor: withAlpha(t.color.accent, 0.7),
    borderRadius: 20,
    paddingVertical: 3,
    paddingRight: 10,
    paddingLeft: 4,
    position: 'relative',
  },
  pillCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pillInitial: {
    fontSize: 13,
    fontWeight: '800',
    color: AVATAR_PILL[t.scheme].initialText,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textOnPrimary,
  },
}));

export default AvatarChip;
