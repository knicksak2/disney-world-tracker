/**
 * CompactEmptyState — the single-line empty indication for an Expanded
 * Group_Body (task 7.2).
 *
 * When a Group_Section is Expanded but its group contains zero completed
 * Experiences, the Group_Body shows this compact indication instead of the
 * large `EmptyState` block used elsewhere. It is intentionally minimal: a
 * single line of muted text conveying that nothing has been completed in that
 * Park or Experience_Category (R11.2).
 *
 * It carries NO navigation affordance — there is no `Pressable`, no
 * `onPress`, no `accessibilityRole`, and no accessibility action — so every
 * tap and assistive-activation gesture within it has nowhere to go and
 * performs no navigation (R11.4).
 *
 * Validates: Requirements 11.2, 11.4
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { theme } from '../../theme/theme';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompactEmptyState({
  message,
  testID,
}: {
  /** The single-line text indicating the group has no completed Experiences. */
  readonly message: string;
  readonly testID?: string;
}): JSX.Element {
  // A plain, non-interactive Text node — deliberately not wrapped in a
  // Pressable and given no accessibility role/action, so it offers no
  // navigation affordance (R11.4).
  return (
    <Text
      style={styles.text}
      numberOfLines={1}
      {...(testID !== undefined ? { testID } : {})}
    >
      {message}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  text: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
    paddingVertical: theme.spacing.sm,
  },
});
