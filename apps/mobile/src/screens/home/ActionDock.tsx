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
import { Pressable, type StyleProp, Text, View, type ViewStyle } from 'react-native';
import { useClaimablePinsBadge } from '../../components/pins/useClaimablePinsBadge';
import { navigateToLiveWaits, navigateToPinBoard } from '../../navigation/navigationRef';
import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { ACTION_DOCK } from './ActionDock.palette';

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
  const styles = useStyles();
  const pal = usePalette(ACTION_DOCK);
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
        <View style={[styles.iconWrap, { backgroundColor: pal.liveWaitsBg }]}>
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
        <View style={[styles.iconWrap, { backgroundColor: pal.logRideBg }]}>
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
        <View style={[styles.iconWrap, { backgroundColor: pal.logSnackBg }]}>
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
            { backgroundColor: isActiveVacation ? pal.dayPlanBg : pal.myPinsBg },
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

const useStyles = makeStyles((t) => ({
  dock: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  dockBtn: {
    flex: 1,
    backgroundColor: t.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ACTION_DOCK[t.scheme].tileBorder,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
    shadowColor: ACTION_DOCK[t.scheme].tileShadow,
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
    ...t.textDefault,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textPrimary,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ACTION_DOCK[t.scheme].badgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: t.color.surface,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: t.color.textOnPrimary,
  },
}));
