// Reusable calendar date-picker field.
//
// A tappable field that shows the selected date and opens an in-app calendar
// modal to pick one. Emits a strict `YYYY-MM-DD` string via `onChange` — the
// exact shape the shared `isoDateSchema`/`tripCreateSchema` and the existing
// change handlers already expect — so it drops in wherever a `YYYY-MM-DD`
// value was used.
//
// The calendar itself is the maintained, pure-JS `react-native-calendars`
// (Wix) `Calendar`, themed to the app's "Magical / Whimsical" purple palette.
// It's pure JS, so no native rebuild is required, and the calendar/date logic
// (month math, leap years, accessibility) is owned by the library rather than
// hand-rolled here.
//
// Dates are handled by string parts (never `new Date(isoString)`) so the
// rendered/selected day never shifts with the device time zone.

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Calendar, type DateData } from 'react-native-calendars';
import type { Theme } from 'react-native-calendars/src/types';

import { theme } from '../theme/theme';
import { SecondaryButton } from '../theme/components';

// ---------------------------------------------------------------------------
// Date helpers (time-zone-free, string-parts based)
// ---------------------------------------------------------------------------

interface Ymd {
  readonly y: number;
  readonly m: number; // 1-12
  readonly d: number; // 1-31
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const pad = (n: number, width: number): string =>
  String(n).padStart(width, '0');

/** Format y/m/d parts to a strict `YYYY-MM-DD` string. */
function formatYmd({ y, m, d }: Ymd): string {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** Number of days in month `m` (1-12) of year `y`, leap years handled. */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * Parse a `YYYY-MM-DD` string into y/m/d parts, verifying the day actually
 * exists (rejects e.g. `2024-02-30`). Returns `null` for anything else.
 */
function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Today's calendar date in the device zone, as a `YYYY-MM-DD` string. */
function todayIso(): string {
  const now = new Date();
  return formatYmd({
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  });
}

/** Human-readable form of a stored value, e.g. "Jan 5, 2024". */
function displayLabel(value: string): string | null {
  const parts = parseYmd(value);
  if (parts === null) return null;
  const month = MONTH_NAMES[parts.m - 1] ?? '';
  return `${month.slice(0, 3)} ${parts.d}, ${parts.y}`;
}

// ---------------------------------------------------------------------------
// Calendar theme (map the app palette onto react-native-calendars' Theme)
// ---------------------------------------------------------------------------

const calendarTheme: Theme = {
  calendarBackground: theme.color.surface,
  monthTextColor: theme.color.textPrimary,
  textMonthFontWeight: '700',
  textSectionTitleColor: theme.color.textSecondary,
  dayTextColor: theme.color.textPrimary,
  textDisabledColor: theme.color.border,
  todayTextColor: theme.color.primary,
  selectedDayBackgroundColor: theme.color.primary,
  selectedDayTextColor: theme.color.textOnPrimary,
  arrowColor: theme.color.primary,
  disabledArrowColor: theme.color.border,
  textDayFontSize: 15,
  textMonthFontSize: 18,
  textDayHeaderFontSize: 12,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DatePickerFieldProps {
  /** Current value as `YYYY-MM-DD`, or `''` when unset. */
  readonly value: string;
  /** Called with the newly selected `YYYY-MM-DD` string. */
  readonly onChange: (value: string) => void;
  /** Text shown when no date is selected. */
  readonly placeholder?: string;
  /** When true, the field is not tappable. */
  readonly disabled?: boolean;
  /**
   * Earliest selectable date as `YYYY-MM-DD`. Days before it are grayed out
   * and not selectable. Used to keep an end date on or after a start date.
   */
  readonly minimumDate?: string;
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

export function DatePickerField({
  value,
  onChange,
  placeholder = 'Select a date',
  disabled = false,
  minimumDate,
  accessibilityLabel,
  testID,
}: DatePickerFieldProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const label = displayLabel(value);

  // The month the calendar opens on: the selected value, else the minimum, else
  // today. Kept as a valid `YYYY-MM-DD` string for the `current` prop.
  const initialMonth = useMemo<string>(() => {
    if (parseYmd(value) !== null) return value;
    if (minimumDate !== undefined && parseYmd(minimumDate) !== null) {
      return minimumDate;
    }
    return todayIso();
  }, [value, minimumDate]);

  const marked = useMemo(() => {
    if (parseYmd(value) === null) return {};
    return {
      [value]: {
        selected: true,
        selectedColor: theme.color.primary,
        selectedTextColor: theme.color.textOnPrimary,
      },
    };
  }, [value]);

  const openPicker = (): void => {
    if (disabled) return;
    setOpen(true);
  };

  const onDayPress = (day: DateData): void => {
    onChange(day.dateString);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        style={({ pressed }) => [
          styles.field,
          pressed && !disabled ? styles.fieldPressed : null,
          disabled ? styles.fieldDisabled : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        testID={testID}
      >
        <Text
          style={[
            styles.fieldText,
            label === null ? styles.fieldPlaceholder : null,
          ]}
        >
          {label ?? placeholder}
        </Text>
        <Ionicons
          name="calendar-outline"
          size={20}
          color={theme.color.textSecondary}
        />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={styles.card}
            testID={testID ? `${testID}-calendar` : undefined}
          >
            <Calendar
              current={initialMonth}
              onDayPress={onDayPress}
              markedDates={marked}
              theme={calendarTheme}
              enableSwipeMonths
              hideExtraDays
              {...(minimumDate !== undefined ? { minDate: minimumDate } : {})}
              {...(testID ? { testID: `${testID}-calendar-view` } : {})}
            />
            <View style={styles.actions}>
              <SecondaryButton
                label="Cancel"
                onPress={() => setOpen(false)}
                style={styles.flexBtn}
                {...(testID ? { testID: `${testID}-cancel` } : {})}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  fieldPressed: {
    borderColor: theme.color.borderStrong,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldText: {
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  fieldPlaceholder: {
    color: theme.color.textSecondary,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    width: '100%',
    maxWidth: 360,
    ...theme.shadow.floating,
  },
  actions: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
