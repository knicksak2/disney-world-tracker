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
  Text,
  View,
  type AccessibilityRole,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { withAlpha } from './theme';
import { useAppTheme } from './useAppTheme';
import { makeStyles } from './makeStyles';
import { DANGER_BUTTON, HEADER } from './components.palette';

// ---------------------------------------------------------------------------
// ScreenContainer — themed page background
// ---------------------------------------------------------------------------

export function ScreenContainer({
  children,
  style,
  testID,
}: {
  readonly children: React.ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}): JSX.Element {
  const styles = useStyles();
  return <View style={[styles.screen, style]} testID={testID}>{children}</View>;
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
  iconText,
  compact = false,
  right,
  onBack,
  backAccessibilityLabel = 'Go back',
  eyebrow,
  colors,
  testID,
  backTestID,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly icon?: keyof typeof Ionicons.glyphMap | undefined;
  readonly iconText?: string | undefined;
  readonly compact?: boolean | undefined;
  readonly right?: React.ReactNode | undefined;
  /**
   * When provided, renders a themed leading back control that invokes this
   * callback on press. The control is exposed to assistive tech as a button
   * (`accessibilityRole="button"`) with `backAccessibilityLabel` as its label.
   * Optional so existing `GradientHeader` usages (Catalog, Home, Stats, etc.)
   * are unaffected.
   */
  readonly onBack?: (() => void) | undefined;
  /** Spoken label for the back control; defaults to "Go back". */
  readonly backAccessibilityLabel?: string | undefined;
  /** Optional greeting or section badge rendered above the title. */
  readonly eyebrow?: string | React.ReactNode | undefined;
  /** Optional custom gradient colors (e.g. park-specific or destination themes). */
  readonly colors?: readonly [string, string, ...string[]] | readonly string[] | undefined;
  /** Optional testID for the root header element. */
  readonly testID?: string | undefined;
  /** Optional testID for the back button. */
  readonly backTestID?: string | undefined;
}): JSX.Element {
  // Add the device's top safe-area inset (status bar / notch height) to the
  // header padding so the leading back control clears the system UI and stays
  // tappable. Without this, `headerCompact`'s small `paddingTop` pushes the
  // back arrow up under the status bar where it can't be reliably pressed.
  //
  // Consume the inset context directly (rather than `useSafeAreaInsets`, which
  // throws when no provider is mounted) so the header still renders in test
  // environments and any other tree without a `SafeAreaProvider`; the real app
  // wraps everything in one (see `App.tsx`), so the true inset is used at run
  // time and we fall back to `0` only when it is genuinely unavailable.
  const insets = React.useContext(SafeAreaInsetsContext);
  const styles = useStyles();
  const t = useAppTheme();
  // Ensure a sensible minimum top gap even when the reported inset is small
  // (e.g. no notch, or the inset is briefly unavailable before the provider
  // measures) so the header — and its back control — never crowds the top edge.
  const topInset = Math.max(insets?.top ?? 0, t.spacing.lg);
  const basePadding = compact ? t.spacing.sm : t.spacing.md;
  const gradientColors = (colors ?? t.gradient.headerVivid) as [string, string, ...string[]];
  return (
    <LinearGradient
      testID={testID}
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.header,
        compact && styles.headerCompact,
        { paddingTop: topInset + basePadding },
      ]}
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
            testID={backTestID}
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
              color={t.color.textOnPrimary}
            />
          </Pressable>
        ) : null}
        <View style={styles.headerTextWrap}>
          {eyebrow !== undefined ? (
            typeof eyebrow === 'string' ? (
              <View style={styles.headerEyebrowPill} testID="header-eyebrow-pill">
                <Text style={styles.headerEyebrowText}>{eyebrow}</Text>
              </View>
            ) : (
              eyebrow
            )
          ) : null}
          <View style={styles.headerTitleRow}>
            {iconText !== undefined ? (
              <Text style={[styles.headerIconText, compact && styles.headerIconTextCompact]}>
                {iconText}
              </Text>
            ) : null}
            {icon !== undefined ? (
              <Ionicons
                name={icon}
                size={compact ? 20 : 24}
                color={t.color.accent}
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
            <Text style={styles.headerSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right !== undefined ? <View style={styles.headerRightWrap}>{right}</View> : null}
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
  const styles = useStyles();
  const cardStyle = [
    styles.card,
    accentColor !== undefined ? styles.cardWithAccent : null,
    accentColor !== undefined ? { borderLeftColor: accentColor } : null,
    style,
  ];
  if (onPress === undefined) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.cardPressed]}
      testID={testID}
      {...(accessibilityRole !== undefined ? { accessibilityRole } : {})}
      {...(accessibilityLabel !== undefined ? { accessibilityLabel } : {})}
    >
      {children}
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
  const styles = useStyles();
  const t = useAppTheme();
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
        colors={t.gradient.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.primaryBtn, isDisabled && styles.btnDisabled]}
      >
        {loading ? (
          <ActivityIndicator color={t.color.textOnPrimary} />
        ) : (
          <View style={styles.btnContent}>
            {icon !== undefined ? (
              <Ionicons
                name={icon}
                size={18}
                color={t.color.textOnPrimary}
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
  const styles = useStyles();
  const t = useAppTheme();
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
            color={tone === 'danger' ? t.color.danger : t.color.primaryFg}
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
  color: colorProp,
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
  const styles = useStyles();
  const t = useAppTheme();
  const badgeColor = colorProp ?? t.color.primaryFg;
  return (
    <View
      style={[styles.badge, { backgroundColor: `${withAlpha(badgeColor, 0.14)}` }]}
      testID={testID}
      {...(accessibilityLabel !== undefined
        ? { accessible: true, accessibilityLabel }
        : {})}
    >
      {icon !== undefined ? (
        <Ionicons name={icon} size={12} color={badgeColor} style={styles.badgeIcon} />
      ) : null}
      <Text style={[styles.badgeText, { color: badgeColor }]} numberOfLines={1}>
        {label}
      </Text>
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
  const styles = useStyles();
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
  const styles = useStyles();
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
  const styles = useStyles();
  const t = useAppTheme();
  return (
    <View style={styles.emptyState} testID={testID}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={28} color={t.color.primaryFg} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body !== undefined ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  header: {
    // `paddingTop` is applied inline in `GradientHeader` as
    // `safeAreaInset.top + base` so the header clears the status bar / notch.
    paddingBottom: t.spacing.lg,
    paddingHorizontal: t.spacing.lg,
    borderBottomLeftRadius: t.radius.xl,
    borderBottomRightRadius: t.radius.xl,
    overflow: 'hidden',
  },
  headerCompact: {
    paddingBottom: t.spacing.md,
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
    marginRight: t.spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  headerEyebrowPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  headerEyebrowText: {
    ...t.typography.meta,
    color: HEADER[t.scheme].eyebrowText,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  headerIcon: {
    marginRight: 2,
  },
  headerIconText: {
    fontSize: 20,
    marginRight: 2,
  },
  headerIconTextCompact: {
    fontSize: 18,
  },
  headerRightWrap: {
    marginLeft: t.spacing.sm,
  },
  headerTitle: {
    color: t.color.textOnPrimary,
    ...t.typography.title,
    flexShrink: 1,
  },
  headerTitleCompact: {
    ...t.typography.title,
    color: t.color.textOnPrimary,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
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
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    ...t.shadow.card,
    ...t.outline.card,
  },
  cardWithAccent: {
    borderLeftWidth: 4,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  btnShadow: {
    ...t.shadow.card,
    borderRadius: t.radius.md,
  },
  primaryBtn: {
    borderRadius: t.radius.md,
    paddingVertical: 14,
    paddingHorizontal: t.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: t.color.textOnPrimary,
    ...t.typography.button,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.sm,
  },
  btnIcon: {
    marginRight: 2,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  secondaryBtn: {
    borderRadius: t.radius.md,
    paddingVertical: 12,
    paddingHorizontal: t.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
  },
  secondaryBtnDanger: {
    backgroundColor: DANGER_BUTTON[t.scheme].bg,
    borderColor: DANGER_BUTTON[t.scheme].border,
  },
  secondaryBtnText: {
    color: t.color.primaryFg,
    ...t.typography.subtitle,
  },
  secondaryBtnTextDanger: {
    color: t.color.danger,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing.md,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    flexShrink: 1,
  },
  badgeIcon: {
    marginRight: 4,
  },
  badgeText: {
    ...t.typography.meta,
    flexShrink: 1,
  },
  chip: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    marginRight: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  chipActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  chipText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  chipTextActive: {
    color: t.color.textOnPrimary,
  },
  sectionLabel: {
    ...t.typography.heading,
    color: t.color.textPrimary,
    marginBottom: t.spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
    gap: t.spacing.sm,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing.xs,
  },
  emptyTitle: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    ...t.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
}));
