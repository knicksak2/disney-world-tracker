/**
 * Shared themed UI primitives for the Disney World Tracker app.
 *
 * These components encapsulate the "Magical / Whimsical" look (see
 * `theme.ts`) so screens compose a consistent design language instead of
 * re-deriving paddings, radii, and colors. Everything here is dependency-
 * light: only `react-native`, `expo-linear-gradient`, `@expo/vector-icons`,
 * and the theme tokens.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { theme } from './theme';

// ---------------------------------------------------------------------------
// ScreenContainer — themed page background
// ---------------------------------------------------------------------------

export function ScreenContainer({
  children,
  style,
}: {
  readonly children: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}): JSX.Element {
  return <View style={[styles.screen, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// GradientHeader — the signature "twilight" banner
// ---------------------------------------------------------------------------

/**
 * A purple gradient header with a scatter of decorative "stars" and an
 * optional Ionicon. Used at the top of primary screens to anchor the
 * magical identity. `compact` trims the vertical padding for inner
 * screens (e.g. detail pages) that already have a navigation header.
 */
export function GradientHeader({
  title,
  subtitle,
  icon,
  compact = false,
  right,
  onBack,
  backAccessibilityLabel = 'Go back',
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly compact?: boolean;
  readonly right?: React.ReactNode;
  /**
   * When provided, renders a themed leading back control that invokes this
   * callback on press. The control is exposed to assistive tech as a button
   * (`accessibilityRole="button"`) with `backAccessibilityLabel` as its label.
   * Optional so existing `GradientHeader` usages (Catalog, Home, Stats, etc.)
   * are unaffected.
   */
  readonly onBack?: () => void;
  /** Spoken label for the back control; defaults to "Go back". */
  readonly backAccessibilityLabel?: string;
}): JSX.Element {
  return (
    <LinearGradient
      colors={theme.gradient.headerVivid}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.header, compact && styles.headerCompact]}
    >
      {/* Decorative sparkles — purely visual, not interactive. */}
      <Ionicons
        name="sparkles"
        size={14}
        color="rgba(255,255,255,0.35)"
        style={styles.sparkleTopRight}
      />
      <Ionicons
        name="star"
        size={10}
        color="rgba(255,255,255,0.25)"
        style={styles.sparkleMidLeft}
      />
      <View style={styles.headerRow}>
        {onBack !== undefined ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerBackBtn,
              pressed && styles.cardPressed,
            ]}
          >
            <Ionicons
              name="arrow-back"
              size={compact ? 22 : 24}
              color={theme.color.textOnPrimary}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerTextWrap}>
          <View style={styles.headerTitleRow}>
            {icon !== undefined ? (
              <Ionicons
                name={icon}
                size={compact ? 20 : 24}
                color={theme.color.accent}
                style={styles.headerIcon}
              />
            ) : null}
            <Text
              style={[styles.headerTitle, compact && styles.headerTitleCompact]}
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>
          {subtitle !== undefined ? (
            <Text style={styles.headerSubtitle}>{subtitle}</Text>
          ) : null}
        </View>
        {right !== undefined ? <View>{right}</View> : null}
      </View>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Card — elevated rounded surface
// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
  onPress,
  accentColor,
  testID,
  accessibilityRole,
  accessibilityLabel,
}: {
  readonly children: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly onPress?: () => void;
  /** Optional left accent stripe color (e.g. park hue). */
  readonly accentColor?: string;
  readonly testID?: string;
  /** Accessibility role forwarded to the pressable wrapper when `onPress` is set. */
  readonly accessibilityRole?: AccessibilityRole;
  /** Accessibility label forwarded to the pressable wrapper when `onPress` is set. */
  readonly accessibilityLabel?: string;
}): JSX.Element {
  const inner = (
    <View
      style={[
        styles.card,
        accentColor !== undefined ? styles.cardWithAccent : null,
        accentColor !== undefined ? { borderLeftColor: accentColor } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress === undefined) {
    return testID !== undefined ? (
      <View testID={testID}>{inner}</View>
    ) : (
      inner
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.cardPressed]}
      testID={testID}
      {...(accessibilityRole !== undefined ? { accessibilityRole } : {})}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
    >
      {inner}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// PrimaryButton / SecondaryButton
// ---------------------------------------------------------------------------

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  icon,
  testID,
  style,
  accessibilityLabel,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  /** Override the spoken label; defaults to the visible `label`. */
  readonly accessibilityLabel?: string;
}): JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={[styles.btnShadow, style]}
    >
      <LinearGradient
        colors={theme.gradient.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.primaryBtn, isDisabled && styles.btnDisabled]}
      >
        {loading ? (
          <ActivityIndicator color={theme.color.textOnPrimary} />
        ) : (
          <View style={styles.btnContent}>
            {icon !== undefined ? (
              <Ionicons
                name={icon}
                size={18}
                color={theme.color.textOnPrimary}
                style={styles.btnIcon}
              />
            ) : null}
            <Text style={styles.primaryBtnText}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  tone = 'neutral',
  icon,
  testID,
  style,
  accessibilityLabel,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly tone?: 'neutral' | 'danger';
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  /** Override the spoken label; defaults to the visible `label`. */
  readonly accessibilityLabel?: string;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={({ pressed }) => [
        styles.secondaryBtn,
        tone === 'danger' && styles.secondaryBtnDanger,
        pressed && styles.cardPressed,
        disabled && styles.btnDisabled,
        style,
      ]}
    >
      <View style={styles.btnContent}>
        {icon !== undefined ? (
          <Ionicons
            name={icon}
            size={18}
            color={tone === 'danger' ? theme.color.danger : theme.color.primary}
            style={styles.btnIcon}
          />
        ) : null}
        <Text
          style={[
            styles.secondaryBtnText,
            tone === 'danger' && styles.secondaryBtnTextDanger,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Badge / Chip
// ---------------------------------------------------------------------------

export function Badge({
  label,
  color: badgeColor = theme.color.primary,
  icon,
  testID,
  accessibilityLabel,
}: {
  readonly label: string;
  readonly color?: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly testID?: string;
  /**
   * Optional screen-reader alternative. When provided the badge is exposed as a
   * single accessible element carrying this label instead of the raw display
   * text, so Info_Tags can convey their meaning (e.g. "Land: Fantasyland").
   */
  readonly accessibilityLabel?: string;
}): JSX.Element {
  return (
    <View
      style={[styles.badge, { backgroundColor: `${hexToRgba(badgeColor, 0.14)}` }]}
      testID={testID}
      {...(accessibilityLabel !== undefined
        ? { accessible: true, accessibilityLabel }
        : {})}
    >
      {icon !== undefined ? (
        <Ionicons name={icon} size={12} color={badgeColor} style={styles.badgeIcon} />
      ) : null}
      <Text style={[styles.badgeText, { color: badgeColor }]}>{label}</Text>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  testID,
  accessibilityLabel,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
  /**
   * Override the spoken label. When omitted the chip derives an accessible
   * label from its visible `label` plus an explicit selected / not-selected
   * state value, so a filter chip conveys both the option name and its
   * selection state to assistive technology (R12.3), e.g. "Ride, selected" /
   * "Ride, not selected". `accessibilityState={{ selected }}` is retained
   * alongside so platforms that surface state natively still do.
   */
  readonly accessibilityLabel?: string;
}): JSX.Element {
  const spokenLabel =
    accessibilityLabel ?? `${label}, ${active ? 'selected' : 'not selected'}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={spokenLabel}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.cardPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// SectionLabel / EmptyState
// ---------------------------------------------------------------------------

export function SectionLabel({
  children,
  style,
}: {
  readonly children: React.ReactNode;
  readonly style?: StyleProp<TextStyle>;
}): JSX.Element {
  return <Text style={[styles.sectionLabel, style]}>{children}</Text>;
}

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  body,
  testID,
}: {
  readonly icon?: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly body?: string;
  readonly testID?: string;
}): JSX.Element {
  return (
    <View style={styles.emptyState} testID={testID}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={28} color={theme.color.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body !== undefined ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a `#rrggbb` hex to an `rgba()` string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.background,
  },
  header: {
    paddingTop: 56,
    paddingBottom: theme.spacing.xl,
    paddingHorizontal: theme.spacing.xl,
    borderBottomLeftRadius: theme.radius.xl,
    borderBottomRightRadius: theme.radius.xl,
    overflow: 'hidden',
  },
  headerCompact: {
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  headerIcon: {
    marginRight: 2,
  },
  headerTitle: {
    color: theme.color.textOnPrimary,
    ...theme.typography.display,
    flexShrink: 1,
  },
  headerTitleCompact: {
    ...theme.typography.title,
    color: theme.color.textOnPrimary,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.82)',
    ...theme.typography.body,
    marginTop: theme.spacing.xs,
  },
  sparkleTopRight: {
    position: 'absolute',
    top: 50,
    right: 24,
  },
  sparkleMidLeft: {
    position: 'absolute',
    bottom: 16,
    left: 60,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  cardWithAccent: {
    borderLeftWidth: 4,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnShadow: {
    ...theme.shadow.card,
    borderRadius: theme.radius.md,
  },
  primaryBtn: {
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: theme.color.textOnPrimary,
    ...theme.typography.button,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  btnIcon: {
    marginRight: 2,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  secondaryBtn: {
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
  },
  secondaryBtnDanger: {
    backgroundColor: '#fdebf2',
    borderColor: '#f3b6cf',
  },
  secondaryBtnText: {
    color: theme.color.primary,
    ...theme.typography.subtitle,
  },
  secondaryBtnTextDanger: {
    color: theme.color.danger,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
  },
  badgeIcon: {
    marginRight: 4,
  },
  badgeText: {
    ...theme.typography.meta,
  },
  chip: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    marginRight: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  chipText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  chipTextActive: {
    color: theme.color.textOnPrimary,
  },
  sectionLabel: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  emptyTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
});
