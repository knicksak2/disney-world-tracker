/**
 * ActionDock — Quick actions dock for the Home command center.
 *
 * Implements Task 15.5 (Requirements 2.1, 2.4).
 * Features 4 quick-action launch tiles:
 *   1. Live Waits (⏱️) -> navigates to LiveWaitsScreen
 *   2. Log Ride (🎢) -> opens LogVisitModal / navigates to Explore
 *   3. Log Snack (🍦) -> opens LogFoodItemModal / navigates to Explore
 *   4. My Pins (📌) -> navigates to Collection tab / PinBoard with claimable badge
 */

import React from 'react';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useClaimablePinsBadge } from '../../components/pins/useClaimablePinsBadge';
import { navigateToLiveWaits, navigateToPinBoard } from '../../navigation/navigationRef';
import { theme } from '../../theme/theme';

export interface ActionDockProps {
  readonly onOpenLogRide?: () => void;
  readonly onOpenLogSnack?: () => void;
  readonly onOpenLiveWaits?: () => void;
  readonly onOpenMyPins?: () => void;
  readonly onOpenSchedule?: () => void;
  readonly isActiveVacation?: boolean;
  readonly dayNumber?: number;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export default function ActionDock({
  onOpenLogRide,
  onOpenLogSnack,
  onOpenLiveWaits,
  onOpenMyPins,
  onOpenSchedule,
  isActiveVacation = false,
  dayNumber = 2,
  testID = 'home-action-dock',
  style,
}: ActionDockProps): JSX.Element {
  const { count: claimablePinCount } = useClaimablePinsBadge();

  const handleLiveWaits = () => {
    if (onOpenLiveWaits) {
      onOpenLiveWaits();
    } else {
      navigateToLiveWaits('Magic Kingdom');
    }
  };

  const handleLogRide = () => {
    onOpenLogRide?.();
  };

  const handleLogSnack = () => {
    onOpenLogSnack?.();
  };

  const handleFourthTile = () => {
    if (isActiveVacation) {
      if (onOpenSchedule) {
        onOpenSchedule();
      } else if (onOpenMyPins) {
        onOpenMyPins();
      } else {
        navigateToPinBoard();
      }
    } else {
      if (onOpenMyPins) {
        onOpenMyPins();
      } else {
        navigateToPinBoard();
      }
    }
  };

  return (
    <View style={[styles.dock, style]} testID={testID}>
      {/* 1. Live Waits */}
      <Pressable
        style={({ pressed }) => [styles.dockBtn, pressed && styles.pressed]}
        onPress={handleLiveWaits}
        accessibilityRole="button"
        accessibilityLabel="Check live wait times"
        testID="home-dock-live-waits"
      >
        <View style={[styles.iconWrap, { backgroundColor: '#eef2ff' }]}>
          <Text style={styles.emojiIcon}>⏱️</Text>
        </View>
        <Text style={styles.label}>Live Waits</Text>
      </Pressable>

      {/* 2. Log Ride */}
      <Pressable
        style={({ pressed }) => [styles.dockBtn, pressed && styles.pressed]}
        onPress={handleLogRide}
        accessibilityRole="button"
        accessibilityLabel="Log attraction or ride"
        testID="home-dock-log-ride"
      >
        <View style={[styles.iconWrap, { backgroundColor: '#fdf2f8' }]}>
          <Text style={styles.emojiIcon}>🎢</Text>
        </View>
        <Text style={styles.label}>Log Ride</Text>
      </Pressable>

      {/* 3. Log Snack */}
      <Pressable
        style={({ pressed }) => [styles.dockBtn, pressed && styles.pressed]}
        onPress={handleLogSnack}
        accessibilityRole="button"
        accessibilityLabel="Log food item or snack"
        testID="home-dock-log-snack"
      >
        <View style={[styles.iconWrap, { backgroundColor: '#fffbeb' }]}>
          <Text style={styles.emojiIcon}>🍦</Text>
        </View>
        <Text style={styles.label}>Log Snack</Text>
      </Pressable>

      {/* 4. Day Plan or My Pins */}
      <Pressable
        style={({ pressed }) => [styles.dockBtn, pressed && styles.pressed]}
        onPress={handleFourthTile}
        accessibilityRole="button"
        accessibilityLabel={
          isActiveVacation
            ? `Day ${dayNumber} plan`
            : `My Pins, ${claimablePinCount} claimable`
        }
        testID="home-dock-my-pins"
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: isActiveVacation ? '#ecfdf5' : '#f5f3ff' },
          ]}
        >
          <Text style={styles.emojiIcon}>{isActiveVacation ? '🗺️' : '📌'}</Text>
        </View>
        <Text style={styles.label}>
          {isActiveVacation ? `Day ${dayNumber} Plan` : 'My Pins'}
        </Text>
        {!isActiveVacation && claimablePinCount > 0 ? (
          <View style={styles.badge} testID="home-dock-pins-badge">
            <Text style={styles.badgeText}>{claimablePinCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  dockBtn: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#eee6f7',
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiIcon: {
    fontSize: 19,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textPrimary,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
  },
});
