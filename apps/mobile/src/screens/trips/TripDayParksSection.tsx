/**
 * Days section on the Trip Detail hub (Requirement 24.8, Task 25.7).
 *
 * Lists every date of the Trip in chronological order:
 *  - Date label
 *  - Park label with park accent color, or "Choose park" affordance
 *  - Opens DayParkPickerSheet on tap to assign or clear the park
 *  - Handles optimistic update, rollback, and error presentation via useSetDayPark
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PARKS, type DayTouringHoursDTO, type Park, type TripDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { TRIP_DAY_PARKS } from './TripDayParksSection.palette';
import { tripDetailKeys } from './tripDetailQueryKeys';
import { getTodayWDW } from './wdwDate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard to narrow a string to a recognized Park. */
export function isKnownPark(value: unknown): value is Park {
  return typeof value === 'string' && (PARKS as readonly string[]).includes(value);
}

/** Enumerates every calendar date (YYYY-MM-DD) from startDate to endDate inclusive. */
export function enumerateTripDates(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  const [sY, sM, sD] = startDate.split('-').map(Number);
  const [eY, eM, eD] = endDate.split('-').map(Number);
  if (!sY || !sM || !sD || !eY || !eM || !eD) return [];

  const dates: string[] = [];
  const cur = new Date(Date.UTC(sY, sM - 1, sD));
  const end = new Date(Date.UTC(eY, eM - 1, eD));

  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Human-readable short date label (e.g. "Thu, Oct 1"). */
export function formatDayDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y && m && d) {
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  } catch {
    // fallback
  }
  return dateStr;
}

// ---------------------------------------------------------------------------
// Mutation hook
// ---------------------------------------------------------------------------

/**
 * Mutation hook for setting/clearing Day_Park with optimistic update on GET /trips/:id.
 */
export function useSetDayPark(tripId: string) {
  const queryClient = useQueryClient();
  const queryKey = tripDetailKeys.detail(tripId);

  return useMutation<
    TripDTO,
    ApiError,
    { date: string; park: Park | null },
    { previousTrip?: TripDTO }
  >({
    mutationFn: ({ date, park }) =>
      apiRequest<TripDTO>('PUT', `/trips/${tripId}/days/${date}/park`, { park }),
    onMutate: async ({ date, park }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousTrip = queryClient.getQueryData<TripDTO>(queryKey);

      if (previousTrip) {
        const nextDayHours = { ...(previousTrip.dayTouringHours ?? {}) };
        if (park !== null) {
          nextDayHours[date] = {
            ...(nextDayHours[date] ?? {}),
            startingPark: park,
          };
        } else {
          if (date in nextDayHours) {
            const entry = { ...nextDayHours[date] };
            delete entry.startingPark;
            if (Object.keys(entry).length === 0) {
              delete nextDayHours[date];
            } else {
              nextDayHours[date] = entry;
            }
          }
        }

        queryClient.setQueryData<TripDTO>(queryKey, {
          ...previousTrip,
          dayTouringHours: nextDayHours,
        });
      }

      return previousTrip ? { previousTrip } : {};
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTrip) {
        queryClient.setQueryData<TripDTO>(queryKey, context.previousTrip);
      }
    },
    onSuccess: (updatedTrip) => {
      queryClient.setQueryData<TripDTO>(queryKey, updatedTrip);
    },
  });
}

// ---------------------------------------------------------------------------
// DayParkPickerSheet
// ---------------------------------------------------------------------------

export interface DayParkPickerSheetProps {
  readonly visible: boolean;
  readonly date: string | null;
  readonly currentPark: Park | null;
  readonly onSelect: (park: Park | null) => void;
  readonly onClose: () => void;
}

export function DayParkPickerSheet({
  visible,
  date,
  currentPark,
  onSelect,
  onClose,
}: DayParkPickerSheetProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(TRIP_DAY_PARKS);

  if (!visible || !date) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.modalOverlay, { backgroundColor: pal.overlayBg }]} onPress={onClose}>
        <Pressable style={styles.sheetContainer} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Choose Park</Text>
              <Text style={styles.sheetSubtitle}>{formatDayDate(date)}</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="close-day-park-picker"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={t.color.textPrimary} />
            </Pressable>
          </View>

          <ScrollView style={styles.optionsList}>
            {PARKS.map((park) => {
              const isSelected = currentPark === park;
              const accentColor = t.parkAccent[park];
              return (
                <Pressable
                  key={park}
                  style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  onPress={() => onSelect(park)}
                  accessibilityRole="button"
                  accessibilityLabel={`${date}, ${park}`}
                  testID={`day-park-picker-option-${park}`}
                >
                  <View style={[styles.sheetParkDot, { backgroundColor: accentColor }]} />
                  <Text style={[styles.optionText, isSelected && { color: accentColor, fontWeight: '700' }]}>
                    {park}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={20} color={accentColor} style={styles.checkIcon} />
                  )}
                </Pressable>
              );
            })}

            {/* "No park yet" option */}
            <Pressable
              style={[styles.optionRow, currentPark === null && styles.optionRowSelected]}
              onPress={() => onSelect(null)}
              accessibilityRole="button"
              accessibilityLabel={`${date}, No park yet`}
              testID="day-park-picker-option-none"
            >
              <View style={[styles.sheetParkDot, { backgroundColor: t.color.textSecondary }]} />
              <Text
                style={[
                  styles.optionText,
                  styles.noParkText,
                  currentPark === null && { fontWeight: '700' },
                ]}
              >
                No park yet
              </Text>
              {currentPark === null && (
                <Ionicons name="checkmark" size={20} color={t.color.textPrimary} style={styles.checkIcon} />
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Section Component
// ---------------------------------------------------------------------------

export interface TripDayParksSectionProps {
  readonly tripId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly dayTouringHours?: Record<string, DayTouringHoursDTO> | undefined;
}

export default function TripDayParksSection({
  tripId,
  startDate: propStartDate,
  endDate: propEndDate,
  dayTouringHours: propDayTouringHours,
}: TripDayParksSectionProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(TRIP_DAY_PARKS);

  const tripQuery = useQuery<TripDTO>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
    enabled: false,
  });

  const startDate = tripQuery.data?.startDate ?? propStartDate;
  const endDate = tripQuery.data?.endDate ?? propEndDate;
  const dayTouringHours = tripQuery.data?.dayTouringHours ?? propDayTouringHours;

  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setDayParkMutation = useSetDayPark(tripId);

  const allDates = useMemo(
    () => enumerateTripDates(startDate, endDate),
    [startDate, endDate],
  );

  const today = getTodayWDW();
  const dates = useMemo(
    () => allDates.filter((d) => d >= today),
    [allDates, today],
  );

  const handleOpenPicker = (date: string) => {
    setErrorMessage(null);
    setActiveDate(date);
  };

  const handleSelectPark = (park: Park | null) => {
    if (!activeDate) return;
    const dateToUpdate = activeDate;
    setActiveDate(null);
    setErrorMessage(null);

    setDayParkMutation.mutate(
      { date: dateToUpdate, park },
      {
        onError: (err) => {
          setErrorMessage(err.message || 'Failed to update day park');
        },
      },
    );
  };

  const currentParkForActiveDate: Park | null = useMemo(() => {
    if (!activeDate) return null;
    const raw = dayTouringHours?.[activeDate]?.startingPark;
    return isKnownPark(raw) ? raw : null;
  }, [activeDate, dayTouringHours]);

  const assignedCount = useMemo(() => {
    return dates.reduce((count, date) => {
      const sp = dayTouringHours?.[date]?.startingPark;
      return isKnownPark(sp) ? count + 1 : count;
    }, 0);
  }, [dates, dayTouringHours]);

  if (dates.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="trip-day-parks-section">
      <View style={styles.sectionHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.sectionTitle}>Days</Text>
          {dates.length > 0 && (
            <Text style={styles.sectionSubtitle}>
              {assignedCount} of {dates.length} planned
            </Text>
          )}
        </View>
      </View>

      {errorMessage && (
        <View style={[styles.errorContainer, { backgroundColor: pal.errorBg }]}>
          <Text style={styles.errorText} testID="day-park-error">
            {errorMessage}
          </Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {dates.map((date) => {
          const startingPark = dayTouringHours?.[date]?.startingPark;
          const park = isKnownPark(startingPark) ? startingPark : null;
          const dateLabel = formatDayDate(date);
          const accentColor = park ? t.parkAccent[park] : undefined;
          const a11yLabel = `${dateLabel} (${date}), ${park ?? 'Choose park'}`;

          return (
            <Pressable
              key={date}
              style={[
                styles.dayCard,
                park && accentColor
                  ? { borderColor: withAlpha(accentColor, 0.45) }
                  : null,
              ]}
              onPress={() => handleOpenPicker(date)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              testID={`day-park-row-${date}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.dayIndexText}>DAY {allDates.indexOf(date) + 1}</Text>
                {park && accentColor ? (
                  <View
                    style={[styles.cardParkDot, { backgroundColor: accentColor }]}
                  />
                ) : (
                  <Ionicons
                    name="calendar-outline"
                    size={12}
                    color={t.color.textSecondary}
                  />
                )}
              </View>

              <Text style={styles.dateText} numberOfLines={1}>
                {dateLabel}
              </Text>

              {park && accentColor ? (
                <View
                  style={[
                    styles.parkBadge,
                    {
                      backgroundColor: withAlpha(accentColor, 0.14),
                      borderColor: withAlpha(accentColor, 0.35),
                    },
                  ]}
                >
                  <Text
                    style={[styles.parkText, { color: accentColor }]}
                    testID={`day-park-label-${date}`}
                    numberOfLines={1}
                  >
                    {park}
                  </Text>
                </View>
              ) : (
                <View style={styles.chooseParkBadge}>
                  <Ionicons
                    name="add"
                    size={13}
                    color={t.color.primaryFg}
                    style={styles.addIcon}
                  />
                  <Text
                    style={styles.chooseParkText}
                    testID={`day-park-label-${date}`}
                    numberOfLines={1}
                  >
                    Choose park
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      <DayParkPickerSheet
        visible={activeDate !== null}
        date={activeDate}
        currentPark={currentParkForActiveDate}
        onSelect={handleSelectPark}
        onClose={() => setActiveDate(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((t) => ({
  container: {
    marginVertical: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  sectionTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  sectionSubtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  errorContainer: {
    marginHorizontal: 16,
    borderRadius: t.radius.sm,
    padding: 8,
    marginBottom: 10,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 10,
    paddingVertical: 2,
  },
  dayCard: {
    width: 140,
    minHeight: 106,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: 10,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayIndexText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardParkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dateText: {
    ...t.typography.body,
    fontWeight: '700',
    color: t.color.textPrimary,
    marginVertical: 4,
  },
  parkBadge: {
    borderRadius: t.radius.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parkText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '700',
  },
  chooseParkBadge: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingVertical: 5,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    marginRight: 3,
  },
  chooseParkText: {
    ...t.typography.meta,
    fontSize: 11,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    paddingBottom: 24,
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  sheetTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  sheetSubtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  optionsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: t.radius.sm,
  },
  optionRowSelected: {
    backgroundColor: t.color.surfaceAlt,
  },
  sheetParkDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  optionText: {
    ...t.typography.body,
    color: t.color.textPrimary,
    flex: 1,
  },
  noParkText: {
    color: t.color.textSecondary,
    fontStyle: 'italic',
  },
  checkIcon: {
    marginLeft: 8,
  },
}));
