// Feature: experience-detail-redesign, Task 16.3 — LensSwitcher
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.6
//
// Two-segment control switching between 'today' (Today in Park) and 'passport'
// (My Passport & Lore). Renders directly beneath QuickSpecsRow.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type LensMode = 'today' | 'passport';

export interface LensSwitcherProps {
  readonly activeLens: LensMode;
  readonly onChangeLens?: (lens: LensMode) => void;
  readonly onLensChange?: (lens: LensMode) => void;
  readonly category?: string | undefined;
  readonly areaType?: string | undefined;
}

export default function LensSwitcher({
  activeLens,
  onChangeLens,
  onLensChange,
  category,
  areaType,
}: LensSwitcherProps): JSX.Element {
  const changeLens = onChangeLens ?? onLensChange;
  const isToday = activeLens === 'today';
  const isPassport = activeLens === 'passport';

  const isResort = category === 'Resort';
  const isResortArea = areaType === 'Resort';

  const todayLabel = isResort
    ? 'Resort Guide'
    : isResortArea
    ? 'Today at Resort'
    : 'Today in Park';

  const passportLabel = isResort
    ? 'Stay Passport & Lore'
    : 'My Passport & Lore';

  const todayIconActive: keyof typeof Ionicons.glyphMap = isResort ? 'bed' : 'flash';
  const todayIconInactive: keyof typeof Ionicons.glyphMap = isResort ? 'bed-outline' : 'flash-outline';

  return (
    <View
      style={styles.container}
      testID="lens-switcher"
      accessibilityRole="tablist"
      accessibilityLabel="Experience view lenses"
    >
      <Pressable
        style={[styles.segment, isToday ? styles.segmentActive : null]}
        onPress={() => changeLens?.('today')}
        testID="lens-tab-today"
        accessibilityRole="tab"
        accessibilityState={{ selected: isToday }}
        accessibilityLabel={`${todayLabel}, tab${isToday ? ', selected' : ''}`}
      >
        <Ionicons
          name={isToday ? todayIconActive : todayIconInactive}
          size={15}
          color={isToday ? '#5b2a86' : '#655d78'}
        />
        <Text
          style={[styles.segmentText, isToday ? styles.segmentTextActive : null]}
        >
          {todayLabel}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.segment, isPassport ? styles.segmentActive : null]}
        onPress={() => changeLens?.('passport')}
        testID="lens-tab-passport"
        accessibilityRole="tab"
        accessibilityState={{ selected: isPassport }}
        accessibilityLabel={`${passportLabel}, tab${isPassport ? ', selected' : ''}`}
      >
        <Ionicons
          name={isPassport ? 'compass' : 'compass-outline'}
          size={16}
          color={isPassport ? '#5b2a86' : '#655d78'}
        />
        <Text
          style={[
            styles.segmentText,
            isPassport ? styles.segmentTextActive : null,
          ]}
        >
          {passportLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#ede6f6',
    borderRadius: 999,
    padding: 4,
    marginHorizontal: 0,
    marginTop: 4,
    marginBottom: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: '#dcd1ec',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  segmentActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#655d78',
  },
  segmentTextActive: {
    color: '#5b2a86',
  },
});
