// Feature: experience-detail-redesign, Task 21.1 — FloatingActionDock
//
// Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7
//
// Behavior summary:
//   - Fixed to the bottom of the screen, rendered across both Lenses for every
//     Experience category (R19.1).
//   - Ride / Character_Meet / Show on Today lens: Primary = "Log visit",
//     Secondary = "Add to plan" (R19.2).
//   - Ride / Character_Meet / Show on Passport lens: Primary = "Log visit",
//     Secondary = "Add to plan" (R19.3).
//   - Restaurant on both lenses: Primary = "Log dish", Secondary = "Reserve table" (R19.4).
//   - Delegates to passed-in existing handlers with no new mutation logic (R19.5).
//   - Provides non-empty accessibility labels reflecting current action labels (R19.6).
//   - Rendered with absolute bottom positioning (R19.7).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ExperienceCategory } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FloatingActionDockProps {
  readonly category: ExperienceCategory;
  readonly activeLens: 'today' | 'passport';
  readonly isQuickService?: boolean | undefined;
  readonly onLogVisit: () => void;
  readonly onAddToPlan: () => void;
  readonly onRateMostRecent?: (() => void) | undefined;
  readonly onRateVisit?: (() => void) | undefined;
  readonly onLogDish: () => void;
  readonly onReserve?: (() => void) | undefined;
  readonly onReserveTable?: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FloatingActionDock({
  category,
  activeLens: _activeLens,
  isQuickService,
  onLogVisit,
  onAddToPlan,
  onRateMostRecent: _onRateMostRecent,
  onRateVisit: _onRateVisit,
  onLogDish,
  onReserve,
  onReserveTable,
}: FloatingActionDockProps): JSX.Element {
  const isRestaurant = category === 'Restaurant';
  const reserveHandler = onReserve ?? onReserveTable ?? (() => {});

  let primaryLabel: string;
  let primaryAccessibilityLabel: string;
  let primaryIcon: keyof typeof Ionicons.glyphMap;
  let primaryHandler: () => void;

  let secondaryLabel: string;
  let secondaryAccessibilityLabel: string;
  let secondaryIcon: keyof typeof Ionicons.glyphMap;
  let secondaryHandler: () => void;

  if (category === 'Resort') {
    // R20.5: Resort on both lenses
    primaryLabel = 'Log Stay';
    primaryAccessibilityLabel = 'Log Stay';
    primaryIcon = 'bed-outline';
    primaryHandler = onLogVisit;

    secondaryLabel = 'Add to Trip';
    secondaryAccessibilityLabel = 'Add to trip';
    secondaryIcon = 'add';
    secondaryHandler = onAddToPlan;
  } else if (isRestaurant) {
    // R19.4, R21.3: Restaurant on both lenses
    primaryLabel = 'Log a Dish';
    primaryAccessibilityLabel = 'Log a Dish';
    primaryIcon = 'restaurant';
    primaryHandler = onLogDish;

    if (isQuickService || (!onReserveTable && !onReserve)) {
      secondaryLabel = 'Add to Trip';
      secondaryAccessibilityLabel = 'Add to trip';
      secondaryIcon = 'add';
      secondaryHandler = onAddToPlan;
    } else {
      secondaryLabel = 'Reserve Table';
      secondaryAccessibilityLabel = 'Reserve Table';
      secondaryIcon = 'calendar-outline';
      secondaryHandler = reserveHandler;
    }
  } else {
    // R19.2, R19.3: Ride/Character_Meet/Show on both Today and Passport lenses
    primaryLabel = 'Log Visit';
    primaryAccessibilityLabel = 'Log visit';
    primaryIcon = 'checkmark-sharp';
    primaryHandler = onLogVisit;

    secondaryLabel = 'Add to Trip';
    secondaryAccessibilityLabel = 'Add to trip';
    secondaryIcon = 'add';
    secondaryHandler = onAddToPlan;
  }

  return (
    <View style={styles.container} testID="floating-action-dock">
      <Pressable
        onPress={primaryHandler}
        accessibilityRole="button"
        accessibilityLabel={primaryAccessibilityLabel}
        testID="dock-primary-action"
        style={({ pressed }) => [
          styles.primaryPill,
          pressed && styles.pillPressed,
        ]}
      >
        <Ionicons name={primaryIcon} size={16} color="#ffffff" />
        <Text style={styles.primaryPillText}>{primaryLabel}</Text>
      </Pressable>

      <Pressable
        onPress={secondaryHandler}
        accessibilityRole="button"
        accessibilityLabel={secondaryAccessibilityLabel}
        testID="dock-secondary-action"
        style={({ pressed }) => [
          styles.secondaryPill,
          pressed && styles.pillPressed,
        ]}
      >
        <Ionicons name={secondaryIcon} size={16} color="#5b2a86" />
        <Text style={styles.secondaryPillText}>{secondaryLabel}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const DOCK_HEIGHT = 80;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(230, 222, 242, 0.95)',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 8,
  },
  primaryPill: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#5b2a86',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 3,
  },
  primaryPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  secondaryPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fbf9fe',
    borderWidth: 1.5,
    borderColor: '#ded3f0',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  secondaryPillText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#371756',
  },
  pillPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.85,
  },
});
