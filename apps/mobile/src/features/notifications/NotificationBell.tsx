/**
 * NotificationBell component for header navigation.
 * (Requirements 8.1, 8.3, design.md Section 12)
 *
 * Wraps useAttentionBadge() unchanged and renders an AttentionBadge
 * overlay on a bell icon button. On press, opens NotificationCenter.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { AttentionBadge } from './AttentionBadge';
import { useAttentionBadge } from './useAttentionBadge';
import { color } from '../../theme/theme';

export interface NotificationBellProps {
  readonly size?: number;
  readonly tintColor?: string;
  readonly testID?: string;
}

export function NotificationBell({
  size = 24,
  tintColor = color.textOnPrimary,
  testID = 'notification-bell',
}: NotificationBellProps): JSX.Element {
  const navigation = useNavigation<any>();
  const { display, count } = useAttentionBadge();

  const handlePress = () => {
    navigation.navigate('NotificationCenter');
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Notifications${count > 0 ? `, ${count} unread` : ''}`}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
      hitSlop={8}
    >
      <Ionicons
        name="notifications-outline"
        size={size}
        color={tintColor}
      />
      {display !== 'hidden' && (
        <View style={styles.badgeOverlay} pointerEvents="none">
          <AttentionBadge
            display={display}
            count={count}
            testID="notification-bell-badge"
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    padding: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  badgeOverlay: {
    position: 'absolute',
    top: -2,
    right: -4,
  },
});

export default NotificationBell;
