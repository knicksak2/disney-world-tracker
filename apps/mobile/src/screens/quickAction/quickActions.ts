/**
 * Pure action list generator for QuickActionSheet.
 * (Requirements 4.2, 4.7, Property 4, design.md Section 4)
 *
 * Fixed action order:
 *   1. Check Live Waits (key: 'liveWaits')
 *   2. Log Ride (key: 'logRide')
 *   3. Log Snack (key: 'logSnack')
 *   4. Claim Pins (key: 'claimPins') — included only when claimablePinCount > 0
 *   5. View Today's Schedule (key: 'todaySchedule')
 */

import type { Ionicons } from '@expo/vector-icons';

export interface QuickAction {
  readonly key: 'liveWaits' | 'logRide' | 'logSnack' | 'claimPins' | 'todaySchedule';
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
}

const ACTION_LIVE_WAITS: QuickAction = {
  key: 'liveWaits',
  label: 'Check Live Waits',
  icon: 'time-outline',
};

const ACTION_LOG_RIDE: QuickAction = {
  key: 'logRide',
  label: 'Log Ride',
  icon: 'checkmark-circle-outline',
};

const ACTION_LOG_SNACK: QuickAction = {
  key: 'logSnack',
  label: 'Log Snack',
  icon: 'restaurant-outline',
};

const ACTION_CLAIM_PINS: QuickAction = {
  key: 'claimPins',
  label: 'Claim Pins',
  icon: 'ribbon-outline',
};

const ACTION_TODAY_SCHEDULE: QuickAction = {
  key: 'todaySchedule',
  label: "View Today's Schedule",
  icon: 'calendar-outline',
};

/**
 * Total, order-preserving projection of the claimable pin count into the quick action list.
 * Pure, never duplicates keys, strictly preserves Requirement 4.2 ordering.
 */
export function buildQuickActions(claimablePinCount: number): readonly QuickAction[] {
  if (claimablePinCount > 0) {
    return [
      ACTION_LIVE_WAITS,
      ACTION_LOG_RIDE,
      ACTION_LOG_SNACK,
      ACTION_CLAIM_PINS,
      ACTION_TODAY_SCHEDULE,
    ];
  }

  return [
    ACTION_LIVE_WAITS,
    ACTION_LOG_RIDE,
    ACTION_LOG_SNACK,
    ACTION_TODAY_SCHEDULE,
  ];
}
