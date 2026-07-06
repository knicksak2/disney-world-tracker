/**
 * TabSelector — the shared tab bar for the View_Selector and the
 * Own_Stats_Selector (task 5.1).
 *
 * Renders one `Pressable` tab per mode, each carrying a distinct icon and a
 * non-empty text label, and marks exactly one tab as active. The component is
 * generic over the mode union `M` so both screens reuse it:
 *
 *   - Friend_Profile_View → `FRIEND_PROFILE_TABS` (Overview / Coverage /
 *     Experiences / Compare).
 *   - Own_Stats_View → `OWN_STATS_TABS` (Own_Overview / Own_Parks /
 *     Own_Categories / Own_Experiences).
 *
 * Accessibility & selection (R1.7, R8.7):
 *
 *   - Each tab is a `Pressable` with `accessibilityRole="tab"` and
 *     `accessibilityState={{ selected: tab.mode === active }}`, so the spoken
 *     selected-state matches the visual selection exactly — set on the active
 *     tab, unset on every inactive tab.
 *   - Each tab exposes `accessibilityLabel` naming its mode.
 *
 * Visible selection treatment (R1.6, R8.6):
 *
 *   - The active tab renders with a filled (primary) background and
 *     text/icon in the on-primary color; inactive tabs render transparent
 *     with muted text. The active tab therefore differs from every inactive
 *     tab in at least one visible attribute (background color, text color,
 *     and icon color all differ).
 *
 * The tab specs are module constants (`FRIEND_PROFILE_TABS`,
 * `OWN_STATS_TABS`) so the icons are distinct, the order is fixed, and the
 * same order is applied identically on every render (R1.1, R1.2, R8.1,
 * R8.2). This component renders only the tab bar; the parent screen mounts
 * the single active mode's pane (R1.4, R8.4) and is notified of taps through
 * `onSelect`.
 *
 * Validates: Requirements 1.1, 1.2, 1.5, 1.6, 1.7, 8.1, 8.2, 8.5, 8.6, 8.7
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../theme/theme';

// ---------------------------------------------------------------------------
// Mode unions
// ---------------------------------------------------------------------------

/**
 * The Profile_View_Modes of the Friend_Profile_View (R1.1). `Compare` hosts the
 * Phase 3 Progress_Comparison section (R12.*).
 */
export type ProfileViewMode =
  | 'Overview'
  | 'Coverage'
  | 'Experiences'
  | 'Compare';

/** The four Own_Stats_View_Modes of the Own_Stats_View (R8.1). */
export type OwnStatsViewMode =
  | 'Own_Overview'
  | 'Own_Parks'
  | 'Own_Areas'
  | 'Own_Categories'
  | 'Own_Experiences';

// ---------------------------------------------------------------------------
// TabSpec
// ---------------------------------------------------------------------------

/**
 * Declarative description of a single tab. One per mode; the icon must be
 * distinct from every other tab's icon and the label must be non-empty
 * (R1.2, R8.2). `accessibilityLabel` names the mode for assistive
 * technologies (R1.7, R8.7).
 */
export interface TabSpec<M extends string> {
  readonly mode: M;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly accessibilityLabel: string;
}

// ---------------------------------------------------------------------------
// Module-constant tab specs (fixed order, distinct icons)
// ---------------------------------------------------------------------------

/**
 * The Friend_Profile_View's View_Selector tabs, in the fixed order
 * Overview → Coverage → Experiences → Compare (R1.1). Each icon is distinct
 * (R1.2). `Coverage` hosts the shared lens-driven `CoverageSection`, and
 * `Compare` hosts the Phase 3 Progress_Comparison (R12.*).
 */
export const FRIEND_PROFILE_TABS: readonly TabSpec<ProfileViewMode>[] = [
  {
    mode: 'Overview',
    label: 'Overview',
    icon: 'person-circle-outline',
    accessibilityLabel: 'Overview',
  },
  {
    mode: 'Coverage',
    label: 'Coverage',
    icon: 'map-outline',
    accessibilityLabel: 'Coverage',
  },
  {
    mode: 'Experiences',
    label: 'Experiences',
    icon: 'list-outline',
    accessibilityLabel: 'Experiences',
  },
  {
    mode: 'Compare',
    label: 'Compare',
    icon: 'git-compare-outline',
    accessibilityLabel: 'Compare',
  },
] as const;

/**
 * The Own_Stats_View's Own_Stats_Selector tabs, in the fixed order
 * Own_Overview → Own_Parks → Own_Areas → Own_Categories → Own_Experiences
 * (R8.1). Each icon is distinct (R8.2).
 */
export const OWN_STATS_TABS: readonly TabSpec<OwnStatsViewMode>[] = [
  {
    mode: 'Own_Overview',
    label: 'Overview',
    icon: 'stats-chart-outline',
    accessibilityLabel: 'Overview',
  },
  {
    mode: 'Own_Parks',
    label: 'Parks',
    icon: 'map-outline',
    accessibilityLabel: 'Parks',
  },
  {
    mode: 'Own_Areas',
    label: 'Areas',
    icon: 'business-outline',
    accessibilityLabel: 'Areas',
  },
  {
    mode: 'Own_Categories',
    label: 'Categories',
    icon: 'grid-outline',
    accessibilityLabel: 'Categories',
  },
  {
    mode: 'Own_Experiences',
    label: 'Experiences',
    icon: 'list-outline',
    accessibilityLabel: 'Experiences',
  },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TabSelector<M extends string>({
  tabs,
  active,
  onSelect,
}: {
  readonly tabs: readonly TabSpec<M>[];
  readonly active: M;
  readonly onSelect: (mode: M) => void;
}): JSX.Element {
  return (
    <View style={styles.bar} accessibilityRole="tablist" testID="tab-selector">
      {tabs.map((tab) => {
        const selected = tab.mode === active;
        return (
          <Pressable
            key={tab.mode}
            onPress={() => {
              onSelect(tab.mode);
            }}
            accessibilityRole="tab"
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityState={{ selected }}
            testID={`tab-${tab.mode}`}
            style={({ pressed }) => [
              styles.tab,
              selected ? styles.tabActive : styles.tabInactive,
              pressed && styles.tabPressed,
            ]}
          >
            <Ionicons
              name={tab.icon}
              size={20}
              color={selected ? theme.color.textOnPrimary : theme.color.textSecondary}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                selected ? styles.labelActive : styles.labelInactive,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    padding: theme.spacing.xs,
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.pill,
  },
  // Active treatment: filled primary background (R1.6, R8.6).
  tabActive: {
    backgroundColor: theme.color.primary,
  },
  // Inactive treatment: transparent over the bar's tinted surface.
  tabInactive: {
    backgroundColor: 'transparent',
  },
  tabPressed: {
    opacity: 0.85,
  },
  label: {
    ...theme.typography.meta,
  },
  labelActive: {
    color: theme.color.textOnPrimary,
  },
  labelInactive: {
    color: theme.color.textSecondary,
  },
});
