/**
 * GroupSection — the collapsible section primitive for the grouped views
 * (task 7.1).
 *
 * Each Park (in a Parks / Own_Parks mode) and each Experience_Category (in a
 * Categories / Own_Categories mode) is rendered as a GroupSection: a tappable
 * Group_Header carrying the group's name + completion statistic, plus a
 * collapsible Group_Body.
 *
 * Behavior:
 *
 *   - **Group_Header (R7.1, R7.3, R12.1–R12.4).** The header is a single
 *     `Pressable` wrapping the caller-supplied `header` content (the existing
 *     stat-header card: name + completed/total + percent, with the same
 *     empty-group figure suppression the underlying mode already applies). It
 *     exposes `accessibilityRole="button"` (an activatable, expandable control,
 *     R12.1), `accessibilityState={{ expanded }}` reflecting the section's
 *     current state (R12.3), and an `accessibilityLabel` containing the Park or
 *     Experience_Category name (R12.2). Pressing it — by direct tap or by an
 *     assistive-technology activation gesture, both of which route through
 *     `onPress` — toggles the section (R7.3, R12.4).
 *
 *   - **Identical header in both states (R9.1–R9.3).** The header `content` is
 *     rendered the same whether the section is Expanded or Collapsed; only the
 *     Group_Body's visibility changes. The name and statistic figures are
 *     owned by the caller's `header` node, so they are byte-for-byte identical
 *     across states.
 *
 *   - **Group_Body (R7.4, R7.5).** `children` (the Group_Body — the group's
 *     Completed_Experience_Rows or a Compact_Empty_State) is rendered ONLY when
 *     `expanded` is true. While Collapsed, the body is hidden (not rendered).
 *
 * This component is presentation-only: the Expanded/Collapsed state is owned by
 * the screen (via `useGroupSections`) and passed in as `expanded`; toggling is
 * delegated to `onToggle`.
 *
 * Validates: Requirements 7.1, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 12.1, 12.2, 12.3, 12.4
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { theme } from '../../theme/theme';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupSection({
  sectionKey,
  expanded,
  onToggle,
  header,
  accessibilityLabel,
  children,
  testID,
}: {
  /** Stable per-section key (namespaced per mode, e.g. `parks:Magic Kingdom`). */
  readonly sectionKey: string;
  /** Whether this section is currently Expanded (owned by the screen). */
  readonly expanded: boolean;
  /** Toggle this section's Expanded/Collapsed state. Receives `sectionKey`. */
  readonly onToggle: (sectionKey: string) => void;
  /** The Group_Header content: name + completion statistic (identical in both states). */
  readonly header: React.ReactNode;
  /** Accessibility label for the header — MUST include the Park/Category name (R12.2). */
  readonly accessibilityLabel: string;
  /** The Group_Body content, rendered only while Expanded (R7.4, R7.5). */
  readonly children: React.ReactNode;
  readonly testID?: string;
}): JSX.Element {
  const handlePress = React.useCallback(() => {
    onToggle(sectionKey);
  }, [onToggle, sectionKey]);

  return (
    <View {...(testID !== undefined ? { testID } : {})}>
      {/* Group_Header — a single activatable, expandable control (R7.1, R7.3,
          R12.1–R12.4). Direct tap and assistive activation both route through
          onPress and perform the same toggle. */}
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [pressed && styles.headerPressed]}
        {...(testID !== undefined ? { testID: `${testID}-header` } : {})}
      >
        {/* Header content is identical whether Expanded or Collapsed (R9.1–R9.3). */}
        {header}
      </Pressable>

      {/* Group_Body — rendered only while Expanded (R7.4, R7.5). Indented with a
          left rail so its rows read as nested children of the header above. */}
      {expanded ? (
        <View
          style={styles.body}
          {...(testID !== undefined ? { testID: `${testID}-body` } : {})}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerPressed: {
    opacity: 0.85,
  },
  // Nest the rows under the header: indent them and draw a left rail so the
  // group header (flush, full-width) is clearly the parent and the rows below
  // are clearly its children.
  body: {
    marginTop: theme.spacing.sm,
    marginLeft: theme.spacing.md,
    paddingLeft: theme.spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.borderStrong,
  },
});
