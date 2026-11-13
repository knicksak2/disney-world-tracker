// Feature: dining-plan-calculator — small labelled controls shared by the Dining Plan sheets and screens.
//
// Every control states its value in text and an icon (a filled or empty radio, a ticked or empty box), never by
// colour alone (Requirement 22.1), and carries an accessibility role, label and state (Requirement 22.2). Colours come
// from the active theme (`makeStyles`, `useAppTheme`), so the controls repaint on a scheme switch.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

export interface OptionItem<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly shortLabel?: string;
  readonly hint?: string;
  readonly icon?: keyof typeof Ionicons.glyphMap;
}

export type OptionGroupLayout = 'list' | 'grid-2' | 'row';

/** A single-choice radio group, rendered as a vertical list, 2x2 grid, or horizontal pill strip. */
export function OptionGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
  layout = 'list',
}: {
  readonly label: string;
  readonly options: readonly OptionItem<V>[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
  readonly testIDPrefix: string;
  readonly layout?: OptionGroupLayout;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  if (layout === 'grid-2' || layout === 'row') {
    const isGrid = layout === 'grid-2';
    return (
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.compactGroup}>
        <Text style={styles.compactGroupLabel}>{label}</Text>
        <View style={isGrid ? styles.gridWrap : styles.rowWrap}>
          {options.map((o) => {
            const selected = o.value === value;
            const visibleLabel = o.shortLabel ?? o.label;
            return (
              <Pressable
                key={o.value}
                onPress={() => onChange(o.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${o.label}${o.hint ? `, ${o.hint}` : ''}`}
                testID={`${testIDPrefix}-${o.value}`}
                style={({ pressed }) => [
                  isGrid ? styles.gridTile : styles.rowPill,
                  selected && styles.pillSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.pillTitleRow}>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={14} color={t.color.textOnPrimary} />
                  ) : o.icon !== undefined ? (
                    <Ionicons name={o.icon} size={13} color={t.color.textSecondary} />
                  ) : null}
                  <Text
                    style={[
                      isGrid ? styles.pillTitle : styles.rowPillTitle,
                      selected && styles.pillTitleSelected,
                    ]}
                    numberOfLines={2}
                  >
                    {visibleLabel}
                  </Text>
                </View>
                {o.hint !== undefined && isGrid ? (
                  <Text style={[styles.pillHint, selected && styles.pillHintSelected]} numberOfLines={2}>
                    {o.hint}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${o.label}${o.hint ? `, ${o.hint}` : ''}`}
            testID={`${testIDPrefix}-${o.value}`}
            style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
          >
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? t.color.primaryFg : t.color.textSecondary} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{o.label}</Text>
              {o.hint !== undefined ? <Text style={styles.hint}>{o.hint}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled checkbox row. */
export function CheckRow({
  label,
  checked,
  onToggle,
  hint,
  compact = false,
  frameless = false,
  testID,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly hint?: string;
  readonly compact?: boolean;
  readonly frameless?: boolean;
  readonly testID: string;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${label}${hint ? `, ${hint}` : ''}`}
      testID={testID}
      style={({ pressed }) => [
        frameless ? styles.rowFrameless : [styles.row, compact && styles.rowCompact],
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={compact || frameless ? 18 : 20} color={checked ? t.color.primaryFg : t.color.textSecondary} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, (compact || frameless) && styles.rowLabelCompact]}>{label}</Text>
        {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A whole-number stepper between `min` and `max`. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  compact = false,
  testIDPrefix,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly compact?: boolean;
  readonly testIDPrefix: string;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const canDown = value > min;
  const canUp = value < max;
  return (
    <View style={[styles.stepperRow, compact && styles.stepperRowCompact]} accessible={false}>
      <Text style={[styles.rowLabel, compact && styles.rowLabelCompact, styles.stepperLabel]}>{label}</Text>
      <Pressable
        onPress={() => canDown && onChange(value - 1)}
        disabled={!canDown}
        accessibilityRole="button"
        accessibilityLabel={`Fewer: ${label}`}
        accessibilityState={{ disabled: !canDown }}
        testID={`${testIDPrefix}-down`}
        style={[styles.stepBtn, compact && styles.stepBtnCompact, !canDown && styles.disabled]}
      >
        <Ionicons name="remove" size={compact ? 16 : 18} color={t.color.primaryFg} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${label}: ${value}`} testID={`${testIDPrefix}-value`}>
        {value}
      </Text>
      <Pressable
        onPress={() => canUp && onChange(value + 1)}
        disabled={!canUp}
        accessibilityRole="button"
        accessibilityLabel={`More: ${label}`}
        accessibilityState={{ disabled: !canUp }}
        testID={`${testIDPrefix}-up`}
        style={[styles.stepBtn, compact && styles.stepBtnCompact, !canUp && styles.disabled]}
      >
        <Ionicons name="add" size={compact ? 16 : 18} color={t.color.primaryFg} />
      </Pressable>
    </View>
  );
}

/** A full-screen sheet header: Close, title, and an optional primary action; padded below the status bar. */
export function SheetHeader({
  title,
  onClose,
  actionLabel,
  onAction,
  actionDisabled = false,
  testIDPrefix,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly actionDisabled?: boolean;
  readonly testIDPrefix: string;
}): JSX.Element {
  const styles = useStyles();
  // The context form, not `useSafeAreaInsets()`, which throws without a provider (tests).
  const insets = React.useContext(SafeAreaInsetsContext);
  return (
    <View style={[styles.header, { paddingTop: theme.spacing.md + (insets?.top ?? 0) }]} testID={`${testIDPrefix}-header`}>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" testID={`${testIDPrefix}-close`} style={styles.headerBtn}>
        <Text style={styles.headerBtnText}>Close</Text>
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>
        {title}
      </Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          onPress={onAction}
          disabled={actionDisabled}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: actionDisabled }}
          testID={`${testIDPrefix}-action`}
          style={[styles.headerBtn, actionDisabled && styles.disabled]}
        >
          <Text style={[styles.headerBtnText, styles.headerAction]}>{actionLabel}</Text>
        </Pressable>
      ) : (
        <View style={styles.headerBtn} />
      )}
    </View>
  );
}

/** A message in words and an icon: `error` for a failure, `info` for a note. */
export function Notice({ tone, text, testID }: { readonly tone: 'error' | 'info' | 'warning'; readonly text: string; readonly testID?: string }): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const icon = tone === 'error' ? 'alert-circle-outline' : tone === 'warning' ? 'warning-outline' : 'information-circle-outline';
  const color = tone === 'error' ? t.color.danger : tone === 'warning' ? t.color.warningText : t.color.primaryFg;
  return (
    <View style={[styles.notice, tone === 'warning' && styles.noticeWarning]} testID={testID} accessibilityRole={tone === 'error' ? 'alert' : 'text'}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.noticeText, { color }]}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { marginBottom: theme.spacing.lg },
  groupLabel: { ...theme.typography.subtitle, color: t.color.textPrimary, marginBottom: theme.spacing.sm },
  compactGroup: { marginBottom: theme.spacing.md },
  compactGroupLabel: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '700', marginBottom: 6 },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rowWrap: { flexDirection: 'row', gap: 6 },
  gridTile: {
    width: '48.8%',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  rowPill: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: { backgroundColor: t.color.primary, borderColor: t.color.primary },
  pillTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillTitle: { ...theme.typography.meta, color: t.color.textPrimary, fontWeight: '700', flexShrink: 1 },
  rowPillTitle: { ...theme.typography.meta, color: t.color.textPrimary, fontWeight: '700', textAlign: 'center' },
  pillTitleSelected: { color: t.color.textOnPrimary },
  pillHint: { fontSize: 11, color: t.color.textSecondary, marginTop: 2 },
  pillHintSelected: { color: t.color.textOnPrimary, opacity: 0.88 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
    marginBottom: theme.spacing.xs,
  },
  rowCompact: { paddingVertical: 8, paddingHorizontal: theme.spacing.sm, marginBottom: 6 },
  rowFrameless: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  rowSelected: { borderColor: t.color.primaryFg, backgroundColor: t.color.surfaceAlt },
  rowText: { flex: 1 },
  rowLabel: { ...theme.typography.body, color: t.color.textPrimary },
  rowLabelCompact: { fontSize: 14 },
  rowLabelSelected: { fontWeight: '700' },
  hint: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  stepperRowCompact: { paddingVertical: 5 },
  stepperLabel: { flex: 1 },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.surface,
  },
  stepBtnCompact: { width: 30, height: 30 },
  stepValue: { ...theme.typography.subtitle, color: t.color.textPrimary, minWidth: 28, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  headerBtn: { minWidth: 64, paddingVertical: theme.spacing.xs },
  headerBtnText: { ...theme.typography.subtitle, color: t.color.primaryFg },
  headerAction: { textAlign: 'right' },
  headerTitle: { ...theme.typography.heading, color: t.color.textPrimary, flex: 1, textAlign: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surfaceAlt,
    marginBottom: theme.spacing.sm,
  },
  noticeWarning: { backgroundColor: t.color.warningSurface },
  noticeText: { fontSize: 12.5, lineHeight: 16, flex: 1 },
}));
