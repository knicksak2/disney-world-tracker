// Feature: dining-plan-calculator — the meal grid: every date of the stay with three meal slots (Requirements 19.3,
// 22.1, 22.2). Each slot states its content in text and an icon and announces its date, meal period and content.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DINING_MEAL_PERIODS, type DiningEntryDTO, type DiningMealPeriod } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  HAND_OFF_EXPLANATION,
  HAND_OFF_MARKER,
  mealPeriodLabel,
  shortDate,
  slotAccessibilityLabel,
  slotLabel,
  stayDates,
  type DayNote,
} from './diningPlanView';

type IconName = keyof typeof Ionicons.glyphMap;

function slotIcon(entry: DiningEntryDTO | undefined): IconName {
  if (entry === undefined) return 'add-circle-outline';
  if (entry.kind === 'skip') return 'remove-circle-outline';
  return 'restaurant-outline';
}

export function DiningMealGrid({
  checkIn,
  checkOut,
  entries,
  onPressSlot,
  dayNotes,
}: {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly entries: readonly DiningEntryDTO[];
  readonly onPressSlot: (date: string, mealPeriod: DiningMealPeriod) => void;
  /** Several hotel stays: the hotel under each date and the switch-day marker (Requirements 25.15, 25.16). */
  readonly dayNotes?: ReadonlyMap<string, DayNote>;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const byKey = new Map(entries.map((e) => [`${e.date}|${e.mealPeriod}`, e]));
  return (
    <View style={styles.grid} testID="dining-meal-grid">
      {stayDates(checkIn, checkOut).map((date) => {
        const note = dayNotes?.get(date);
        return (
        <View key={date} style={styles.day}>
          <Text style={styles.date}>{shortDate(date)}</Text>
          {note !== undefined ? (
            <Text style={styles.hotel} testID={`dining-day-hotel-${date}`}>
              {note.handOff ? `${note.hotels[0]}, then ${note.hotels.slice(1).join(', then ')}` : note.hotels[0]}
            </Text>
          ) : null}
          {note?.handOff === true ? (
            <View style={styles.handOff} testID={`dining-handoff-${date}`} accessible accessibilityLabel={`${HAND_OFF_MARKER} ${HAND_OFF_EXPLANATION}`}>
              <Ionicons name="swap-horizontal-outline" size={16} color={t.color.primaryFg} />
              <View style={styles.handOffText}>
                <Text style={styles.handOffMarker}>{HAND_OFF_MARKER}</Text>
                <Text style={styles.handOffExplain}>{HAND_OFF_EXPLANATION}</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.slots}>
            {DINING_MEAL_PERIODS.map((period) => {
              const entry = byKey.get(`${date}|${period}`);
              return (
                <Pressable
                  key={period}
                  onPress={() => onPressSlot(date, period)}
                  accessibilityRole="button"
                  accessibilityLabel={slotAccessibilityLabel(date, period, entry)}
                  testID={`dining-slot-${date}-${period}`}
                  style={({ pressed }) => [styles.slot, entry === undefined && styles.slotEmpty, pressed && styles.pressed]}
                >
                  <View style={styles.slotHead}>
                    <Ionicons name={slotIcon(entry)} size={14} color={entry === undefined ? t.color.textSecondary : t.color.primaryFg} />
                    <Text style={styles.period}>{mealPeriodLabel(period)}</Text>
                  </View>
                  <Text style={[styles.content, entry === undefined && styles.contentEmpty]}>{slotLabel(entry)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  grid: { marginBottom: theme.spacing.lg },
  day: { marginBottom: theme.spacing.sm },
  date: { ...theme.typography.subtitle, color: t.color.textPrimary, marginBottom: theme.spacing.xs },
  hotel: { ...theme.typography.meta, color: t.color.textSecondary, marginTop: -2, marginBottom: theme.spacing.xs },
  handOff: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surfaceAlt,
    marginBottom: theme.spacing.xs,
  },
  handOffText: { flex: 1 },
  handOffMarker: { ...theme.typography.body, color: t.color.textPrimary, fontWeight: '700' },
  handOffExplain: { ...theme.typography.meta, color: t.color.textSecondary, fontWeight: '400' },
  slots: { flexDirection: 'row', gap: theme.spacing.xs },
  slot: {
    flex: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
    minHeight: 64,
  },
  slotEmpty: { borderStyle: 'dashed', borderColor: t.color.border, backgroundColor: t.color.surfaceAlt },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  period: { ...theme.typography.meta, color: t.color.textSecondary },
  content: { ...theme.typography.body, color: t.color.textPrimary, marginTop: 2 },
  contentEmpty: { color: t.color.textSecondary },
  pressed: { opacity: 0.8 },
}));
