// Feature: experience-detail-redesign, Task 17.1 — VirtualQueueBanner
//
// Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5
//
// Renders the boarding-group / virtual-queue banner only when `boardingGroup.state`
// is a non-empty string. Displays current group range when both start and end are present.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LiveDetailDTO } from '@dwt/shared';

export interface VirtualQueueBannerProps {
  readonly boardingGroup?: LiveDetailDTO['boardingGroup'];
}

export default function VirtualQueueBanner({
  boardingGroup,
}: VirtualQueueBannerProps): JSX.Element | null {
  // Requirement 15.1, 15.3: renders if and only if boardingGroup.state is a non-empty string
  if (!boardingGroup || typeof boardingGroup.state !== 'string' || boardingGroup.state.trim().length === 0) {
    return null;
  }

  const state = boardingGroup.state.trim();
  const hasRange =
    typeof boardingGroup.currentGroupStart === 'number' &&
    typeof boardingGroup.currentGroupEnd === 'number';

  const rangeText = hasRange
    ? `Groups ${boardingGroup.currentGroupStart}\u2013${boardingGroup.currentGroupEnd}`
    : null;

  const a11yLabel = `Virtual Queue: ${state}${
    hasRange ? `, Boarding Groups ${boardingGroup.currentGroupStart} to ${boardingGroup.currentGroupEnd}` : ''
  }`;

  return (
    <View
      style={styles.container}
      testID="experience-virtual-queue-banner"
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.titleWrap}>
        <Ionicons name="ticket-outline" size={16} color="#1d4ed8" />
        <Text style={styles.titleText}>
          Virtual Queue:{' '}
          <Text style={styles.stateText} testID="vq-state">
            {state}
          </Text>
        </Text>
      </View>

      {rangeText ? (
        <View style={styles.rangeBadge} testID="vq-group-range">
          <Text style={styles.rangeText}>{rangeText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginVertical: 6,
    gap: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  titleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e40af',
  },
  stateText: {
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rangeBadge: {
    backgroundColor: '#dbeafe',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  rangeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1d4ed8',
  },
});
