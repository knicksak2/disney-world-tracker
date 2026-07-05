// Feature: experience-detail-redesign, Task 5.1 — Collapsible About_Section
//
// Validates: Requirements R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8,
//            R5.9, R5.10
//
// A themed `Card` section that renders the Experience `description` and
// collapses long copy behind a "Read more" / "Read less" toggle:
//
//   - absent / empty / whitespace-only description → the existing
//     "No description available." empty state, and no toggle (R5.8).
//   - description present → the text rendered at most 4 lines while collapsed
//     (`numberOfLines={4}`, R5.1) and unclamped while expanded.
//   - overflow detection: a hidden, unclamped measurement pass counts the real
//     laid-out line count via `onTextLayout`. The Read_More_Toggle is rendered
//     only when that count exceeds the 4-line collapsed limit (R5.2, R5.3).
//   - initial state is collapsed, so a description that overflows first renders
//     collapsed (R5.9).
//   - the toggle shows "Read more" while collapsed (R5.4) and "Read less" while
//     expanded (R5.6); activating it flips the state (R5.5, R5.7) and always
//     carries a non-empty accessibility label reflecting the current action
//     (R5.10).
//
// It uses the shared Magical / Whimsical theme primitives (Card, SectionLabel)
// and the same `bodyText` / `empty` text styles as the other detail sections so
// it matches the surrounding layout.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

import { theme } from '../../theme/theme';
import { Card, SectionLabel } from '../../theme/components';

/**
 * The collapsed line limit (R5.1). While collapsed the description is clamped
 * to at most this many lines, and it is the threshold above which the
 * Read_More_Toggle is shown (R5.2 / R5.3).
 */
export const COLLAPSED_LINE_LIMIT = 4;

export interface AboutSectionProps {
  /**
   * The Experience `description`. Treated as absent when it is `null`,
   * `undefined`, empty, or whitespace-only, which drives the empty state (R5.8).
   */
  readonly description: string | null | undefined;
}

/**
 * The collapsible About_Section. See the module header for the full render
 * behavior. Always returns a `Card` (the empty state is rendered inside it) so
 * the section keeps a consistent slot in the detail scroll view.
 */
export default function AboutSection({
  description,
}: AboutSectionProps): JSX.Element {
  // Initial state is collapsed (R5.9). `overflow` starts false and flips to
  // true only once the hidden measurement pass reports more than the collapsed
  // limit of lines (R5.2 / R5.3).
  const [expanded, setExpanded] = React.useState(false);
  const [overflow, setOverflow] = React.useState(false);

  const text = typeof description === 'string' ? description : '';
  const hasText = text.trim().length > 0;

  const handleMeasureLayout = React.useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      // The measurement text is never clamped, so `lines.length` is the true
      // line count of the full description regardless of platform truncation
      // behavior on the visible (clamped) copy.
      const lineCount = event.nativeEvent.lines.length;
      setOverflow(lineCount > COLLAPSED_LINE_LIMIT);
    },
    [],
  );

  // R5.8: absent / empty / whitespace-only description renders the existing
  // empty state and no toggle.
  if (!hasText) {
    return (
      <Card style={styles.section} testID="about-section">
        <SectionLabel>About</SectionLabel>
        <Text style={styles.empty} testID="about-empty">
          No description available.
        </Text>
      </Card>
    );
  }

  // R5.4 / R5.6 / R5.10: the toggle affordance and its accessibility label
  // reflect the action the user would take next.
  const toggleLabel = expanded ? 'Read less' : 'Read more';

  return (
    <Card style={styles.section} testID="about-section">
      <SectionLabel>About</SectionLabel>

      {/* Hidden, unclamped measurement pass. It is taken out of the normal
          layout flow and hidden from assistive tech; its sole purpose is to
          report the full line count so we can decide whether the description
          overflows the collapsed limit (R5.2, R5.3). */}
      <Text
        style={[styles.bodyText, styles.measure]}
        onTextLayout={handleMeasureLayout}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID="about-measure"
      >
        {text}
      </Text>

      {/* Visible copy: clamped to the collapsed limit unless expanded (R5.1). */}
      <Text
        style={styles.bodyText}
        numberOfLines={expanded ? undefined : COLLAPSED_LINE_LIMIT}
        testID="about-text"
      >
        {text}
      </Text>

      {/* R5.2 / R5.3: the toggle exists only when the description overflows. */}
      {overflow ? (
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={toggleLabel}
          hitSlop={8}
          testID="about-toggle"
          style={({ pressed }) => [
            styles.toggle,
            pressed && styles.togglePressed,
          ]}
        >
          <Text style={styles.toggleText}>{toggleLabel}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: theme.spacing.md,
  },
  bodyText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    lineHeight: 20,
  },
  empty: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  // Off-screen measurement copy: absolutely positioned and fully transparent
  // so it neither occupies layout space nor is visible to the user, while
  // still being laid out (which is what fires `onTextLayout`).
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  toggle: {
    alignSelf: 'flex-start',
  },
  togglePressed: {
    opacity: 0.6,
  },
  toggleText: {
    ...theme.typography.subtitle,
    color: theme.color.primary,
  },
});
