// Feature: trip-reservations, task 8.1 — shared hour / minute / AM-PM wheel.
//
// Extracted from the inline wheel that lived in `TripScheduleScreen` so there is
// one implementation rather than two that can drift. The meridiem is always an
// explicit selection, which is the point: free-text entry let "1:00" be read as
// 1 AM when the user meant 1 PM, and a booking time saved twelve hours off is a
// silent data error. A picked AM/PM makes that unrepresentable.
//
// `minuteStep` differs by caller on purpose. The Schedule Builder is choosing a
// touring *preference*, where quarter hours are plenty. A Reservation records a
// real booking, so it needs 5-minute granularity — a 6:25 PM dining reservation
// must be expressible.
//
// Validates: trip-reservations Requirements 3.8, 3.9, 3.10, 3.11

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme/theme';

/** 12-hour clock hours, in wheel order. */
export const WHEEL_HOURS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

/** Meridiem options. */
export const WHEEL_MERIDIEMS = ['AM', 'PM'] as const;

export type MinuteStep = 5 | 15;

/** The minute options offered for a given granularity. */
export function wheelMinutes(step: MinuteStep): readonly string[] {
  const minutes: string[] = [];
  for (let m = 0; m < 60; m += step) {
    minutes.push(String(m).padStart(2, '0'));
  }
  return minutes;
}

export interface TimeWheelPickerProps {
  /**
   * Current selection as `H:MM AM/PM`, or `''` when nothing has been chosen.
   * An empty value renders with no selection highlighted, which is what lets a
   * caller require an explicit choice before submitting (R3.11).
   */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Minute granularity. Defaults to 15 (the Schedule Builder's behavior). */
  readonly minuteStep?: MinuteStep;
  readonly testIDPrefix: string;
}

interface WheelSelection {
  readonly hour: string;
  readonly minute: string;
  readonly meridiem: string;
}

/**
 * Split a `H:MM AM/PM` value into its wheel selections. An unset or unparseable
 * value yields empty strings so nothing renders as selected — the picker must
 * not imply a choice the user did not make.
 */
export function parseWheelValue(value: string, step: MinuteStep): WheelSelection {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return { hour: '', minute: '', meridiem: '' };

  const hourNum = Number.parseInt(match[1]!, 10);
  const rawMinute = match[2]!;
  const options = wheelMinutes(step);
  return {
    hour: String(hourNum % 12 || 12),
    // Snap to the nearest offered option so a stored 6:25 still highlights on a
    // 15-minute wheel rather than showing nothing.
    minute: options.includes(rawMinute) ? rawMinute : (options[0] ?? '00'),
    meridiem: match[3]!.toUpperCase(),
  };
}

/** Defaults applied when the user picks one column before the others are set. */
const DEFAULT_HOUR = '12';
const DEFAULT_MERIDIEM = 'PM';

export function TimeWheelPicker({
  value,
  onChange,
  minuteStep = 15,
  testIDPrefix,
}: TimeWheelPickerProps): JSX.Element {
  const { hour, minute, meridiem } = parseWheelValue(value, minuteStep);
  const minutes = wheelMinutes(minuteStep);

  // Picking any single column completes the value using sensible defaults for
  // the columns not yet chosen, so one tap always produces a usable time.
  const emit = (next: Partial<WheelSelection>): void => {
    const h = next.hour ?? (hour || DEFAULT_HOUR);
    const m = next.minute ?? (minute || (minutes[0] ?? '00'));
    const mer = next.meridiem ?? (meridiem || DEFAULT_MERIDIEM);
    onChange(`${h}:${m} ${mer}`);
  };

  return (
    <View style={styles.grid} testID={`${testIDPrefix}-wheel`}>
      <View style={styles.column}>
        <Text style={styles.columnHeader}>Hour</Text>
        <ScrollView style={styles.scroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {WHEEL_HOURS.map((h) => {
            const selected = hour === h;
            return (
              <Pressable
                key={h}
                style={[styles.item, selected && styles.itemActive]}
                onPress={() => emit({ hour: h })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Hour ${h}`}
                testID={`${testIDPrefix}-hour-${h}`}
              >
                <Text style={[styles.itemText, selected && styles.itemTextActive]}>{h}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.column}>
        <Text style={styles.columnHeader}>Min</Text>
        <ScrollView style={styles.scroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {minutes.map((m) => {
            const selected = minute === m;
            return (
              <Pressable
                key={m}
                style={[styles.item, selected && styles.itemActive]}
                onPress={() => emit({ minute: m })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Minute ${m}`}
                testID={`${testIDPrefix}-minute-${m}`}
              >
                <Text style={[styles.itemText, selected && styles.itemTextActive]}>:{m}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.column}>
        <Text style={styles.columnHeader}>AM / PM</Text>
        <View style={styles.meridiemBox}>
          {WHEEL_MERIDIEMS.map((mer) => {
            const selected = meridiem === mer;
            return (
              <Pressable
                key={mer}
                style={[styles.meridiemBtn, selected && styles.meridiemBtnActive]}
                onPress={() => emit({ meridiem: mer })}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={mer}
                testID={`${testIDPrefix}-meridiem-${mer}`}
              >
                <Text style={[styles.meridiemText, selected && styles.meridiemTextActive]}>
                  {mer}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    height: 140,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  columnHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  scroll: {
    width: '100%',
  },
  item: {
    paddingVertical: theme.spacing.xs,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    marginVertical: 1,
  },
  itemActive: {
    backgroundColor: theme.color.primary,
  },
  itemText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  itemTextActive: {
    color: theme.color.textOnPrimary,
  },
  meridiemBox: {
    width: '100%',
    gap: theme.spacing.xs,
    marginTop: 4,
  },
  meridiemBtn: {
    paddingVertical: theme.spacing.xs + 2,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  meridiemBtnActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  meridiemText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  meridiemTextActive: {
    color: theme.color.textOnPrimary,
  },
});
