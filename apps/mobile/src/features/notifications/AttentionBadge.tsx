/**
 * Attention_Badge presentational component (task 13.2).
 *
 * A pure, presentational count badge for the Notification_Center. It renders
 * the app-wide "needs your attention" indicator from a {@link BadgeDisplay}
 * mode plus the numeric count that backs it:
 *
 * - `'hidden'`   → renders nothing (total attention count is zero) (R4.2, R10.4).
 * - `'count'`    → renders the exact count, 1–99 (R4.3).
 * - `'overflow'` → renders "99+", for a count of 100 or more (R4.4).
 *
 * It is intentionally **props-in, view-out**: it does not call
 * {@link useAttentionBadge} or any hook, so the same view can be placed on the
 * Profile tab icon, in the screen header, or anywhere else, and is trivially
 * testable. The caller (the Profile tab icon / screen header) reads the badge
 * state and passes `display` + `count` down.
 *
 * Because both the visible/hidden decision and the rendered text are derived
 * from the single `display` mode (itself derived from the one `badgeCount`),
 * the indicator is always consistent with the count (R4.6).
 *
 * Styling mirrors the existing tab-bar badge in `RootNavigator` so the
 * app-wide indicator looks the same wherever it appears.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 10.3, 10.4
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type BadgeDisplay } from '@dwt/shared';

/** The literal shown when the count overflows the two-digit badge (R4.4). */
const OVERFLOW_LABEL = '99+';

export interface AttentionBadgeProps {
  /**
   * The derived badge display mode: `'hidden'` shows no indicator, `'count'`
   * shows the exact value, `'overflow'` shows "99+".
   */
  readonly display: BadgeDisplay;
  /**
   * The total attention count backing the badge. Shown verbatim when
   * `display` is `'count'`; ignored (but kept for consistency and the
   * accessibility label) otherwise.
   */
  readonly count: number;
  /** Overrides the default testID so multiple placements can be distinguished. */
  readonly testID?: string;
}

/**
 * Render the Attention_Badge for a given display mode and count.
 *
 * Returns `null` when `display` is `'hidden'`, so a zero attention count draws
 * nothing at all (no empty pill) — matching the tab-bar badge's
 * `count > 0`-gated rendering.
 */
export function AttentionBadge({
  display,
  count,
  testID = 'attention-badge',
}: AttentionBadgeProps): JSX.Element | null {
  if (display === 'hidden') {
    return null;
  }

  const label = display === 'overflow' ? OVERFLOW_LABEL : String(count);

  return (
    <View
      style={styles.badge}
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label} items need your attention`}
    >
      <Text style={styles.badgeText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Mirrors the tab-bar badge styling in `RootNavigator` (a small red pill with
// white, bold text) so the indicator is visually identical wherever it renders.
const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#e11d48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
