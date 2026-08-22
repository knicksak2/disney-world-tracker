import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import {
  type CrowdCalendarDayDTO,
  type DayTouringHoursDTO,
  type ExperienceDTO,
  type MealPeriod,
  type PlannedItemDTO,
  type PlannedItemEditInput,
  type ReservationKind,
  type TripDTO,
  type TripEditInput,
  type TripOptimizationResult,
  type WalkingSpeed,
  MEAL_WINDOWS,
  MEAL_SERVICE_WINDOWS,
  isMealPeriodServed,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  SecondaryButton,
  ScreenContainer,
} from '../../theme/components';
import { tripPlannedListKeys } from './TripPlannedListScreen';
import { tripDetailKeys } from './TripDetailScreen';
import { ExperiencePicker } from './ExperiencePicker';
import { isKnownPark } from './experiencePickerFilters';
import { reservationKindPresentation } from './reservations';
import { TimeWheelPicker } from '../../components/TimeWheelPicker';

/**
 * Timeline badge label for a Reservation (trip-reservations R4.3). Carries the
 * kind as words, not just an icon or a color, so a real booking is
 * distinguishable from a self-pinned time for every user.
 */
function reservationBadgeLabel(kind: ReservationKind): string {
  return `🎟️ ${reservationKindPresentation(kind).label}`;
}

type Props = NativeStackScreenProps<TripsStackParamList, 'TripSchedule'>;

const WDW_TIME_ZONE = 'America/New_York';

function getETOffsetMinutes(dateString: string): number {
  const d = new Date(`${dateString}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  let y = 0, mo = 0, day = 0, h = 0, m = 0, s = 0;
  for (const part of parts) {
    if (part.type === 'year') y = parseInt(part.value, 10);
    if (part.type === 'month') mo = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
    if (part.type === 'hour') h = parseInt(part.value, 10);
    if (part.type === 'minute') m = parseInt(part.value, 10);
    if (part.type === 'second') s = parseInt(part.value, 10);
  }
  if (h === 24) h = 0;
  const localDate = Date.UTC(y, mo - 1, day, h, m, s);
  return Math.round((localDate - d.getTime()) / 60000);
}

function formatTimeDisplay(isoString: string | null | undefined): string {
  if (!isoString) return '--:--';
  if (isoString.includes('T')) {
    try {
      const d = new Date(isoString);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: WDW_TIME_ZONE,
          hour: 'numeric',
          minute: '2-digit',
        }).format(d);
      }
    } catch {
      // fallback below
    }
  }
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(isoString)) {
    const [hStr, mStr] = isoString.split(':');
    const h = parseInt(hStr!, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${mStr} ${ampm}`;
  }
  return isoString;
}

export function formatMinutesToTime(mins: number | null | undefined): string {
  if (mins == null) return '';
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mStr = String(m).padStart(2, '0');
  return `${h12}:${mStr} ${ampm}`;
}

/** Format an `optimized_at` ISO timestamp as a short ET date + time (R8.2). */
function formatLastOptimized(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: WDW_TIME_ZONE,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  } catch {
    return null;
  }
}

function formatDatePill(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y && m && d) {
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    }
  } catch {
    // fallback below
  }
  return dateStr;
}

/** Return today's date in YYYY-MM-DD in the WDW (America/New_York) timezone. */
export function getTodayWDW(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WDW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

function generateDateRange(startDateStr?: string, endDateStr?: string, filterPastDates = false): string[] {
  if (!startDateStr) return [];
  if (!endDateStr || endDateStr === startDateStr) {
    if (filterPastDates && startDateStr < getTodayWDW()) return [];
    return [startDateStr];
  }
  try {
    const dates: string[] = [];
    const curr = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    const todayStr = filterPastDates ? getTodayWDW() : '';
    while (curr <= end && dates.length < 14) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      if (!filterPastDates || dateStr >= todayStr) {
        dates.push(dateStr);
      }
      curr.setDate(curr.getDate() + 1);
    }
    return dates;
  } catch {
    return filterPastDates && startDateStr < getTodayWDW() ? [] : [startDateStr];
  }
}

function normalizeDateStr(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (dateStr.includes('T')) return dateStr.split('T')[0] ?? null;
  return dateStr;
}

function parseTimeInputToIso(inputStr: string, baseDateStr: string): string | null {
  const trimmed = inputStr.trim().toUpperCase();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!match) return null;

  let hours = parseInt(match[1]!, 10);
  const minutes = parseInt(match[2]!, 10);
  const ampm = match[3];

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;

  const normDate = normalizeDateStr(baseDateStr);
  const datePart = normDate && /^\d{4}-\d{2}-\d{2}$/.test(normDate) ? normDate : '2026-08-20';

  const offsetMins = getETOffsetMinutes(datePart);
  const midnightET_UTC = new Date(`${datePart}T00:00:00Z`).getTime() - offsetMins * 60000;
  const targetUTC = midnightET_UTC + (hours * 60 + minutes) * 60000;

  return new Date(targetUTC).toISOString();
}

function getLLWindowInfo(passTimeText: string, activeDate: string): { windowStr: string; graceStr: string } | null {
  if (!passTimeText.trim()) return null;
  const iso = parseTimeInputToIso(passTimeText, activeDate);
  if (!iso) return null;

  const normDate = normalizeDateStr(activeDate) ?? '2026-08-20';
  const targetTime = new Date(iso).getTime();
  const offsetMins = getETOffsetMinutes(normDate);
  const midnightET_UTC = new Date(`${normDate}T00:00:00Z`).getTime() - offsetMins * 60000;
  const startMins = Math.round((targetTime - midnightET_UTC) / 60000);

  const formatMins = (m: number) => {
    const norm = (m + 1440) % 1440;
    let h = Math.floor(norm / 60);
    const min = norm % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(min).padStart(2, '0')} ${ampm}`;
  };

  return {
    windowStr: `${formatMins(startMins)} – ${formatMins(startMins + 60)}`,
    graceStr: `${formatMins(startMins - 5)} – ${formatMins(startMins + 75)}`,
  };
}

export function getMealWindowLabel(period: MealPeriod): string {
  const w = MEAL_WINDOWS[period];
  if (!w) return '';
  return `${formatMinutesToTime(w.startMinutes)} – ${formatMinutesToTime(w.endMinutes)}`;
}

export function getMealServiceWindowLabel(period: MealPeriod): string {
  const w = MEAL_SERVICE_WINDOWS[period];
  if (!w) return '';
  return `${formatMinutesToTime(w.startMinutes)} – ${formatMinutesToTime(w.endMinutes)}`;
}

// The hour / minute / AM-PM wheel and its value parsing now live in the shared
// `TimeWheelPicker` component (trip-reservations task 8.1), so this screen and
// the Reservations screen cannot drift apart.

function formatOptimizationWarning(warningKey: string, items: readonly PlannedItemDTO[]): string {
  if (warningKey === 'infeasible_fixed_gap') {
    return 'Fixed reservation times are tight or overlap with travel time.';
  }
  if (warningKey === 'expired_lightning_lane') {
    return 'A Lightning Lane return window expired before arrival.';
  }
  if (warningKey === 'over_constrained') {
    return 'Some lower-priority items could not be fitted into today’s timeline.';
  }
  if (warningKey.startsWith('lightning_lane:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `⚡ ${item.experienceName} planned via Lightning Lane` : '⚡ Planned via Lightning Lane';
  }
  if (warningKey.startsWith('single_rider:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `👤 ${item.experienceName} planned via Single Rider line` : '👤 Planned via Single Rider line';
  }
  if (warningKey.startsWith('virtual_queue:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `🎟️ ${item.experienceName} uses Virtual Queue (join at 7 AM / 1 PM)` : '🎟️ Virtual Queue item';
  }
  if (warningKey.startsWith('show:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `🎭 ${item.customTitle || item.experienceName} scheduled for showtime` : '🎭 Scheduled for showtime';
  }
  if (warningKey.startsWith('typical_showtimes:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item
      ? `🎭 Estimated showtime based on past schedule for ${item.customTitle || item.experienceName}`
      : '🎭 Estimated showtime based on past schedule';
  }
  if (warningKey.startsWith('outside_window:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `⚠️ ${item.customTitle || item.experienceName} scheduled outside target time window` : '⚠️ Item scheduled outside target time window';
  }
  if (warningKey.startsWith('showtimes_unavailable:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `⚠️ No available showtimes remaining today for ${item.customTitle || item.experienceName}` : '⚠️ No available showtimes remaining today for show';
  }
  if (warningKey.startsWith('show_missed:')) {
    const itemId = warningKey.split(':')[1];
    const item = items.find((i) => i.id === itemId);
    return item ? `⚠️ Missed all available showtimes for ${item.customTitle || item.experienceName}` : '⚠️ Missed all available showtimes for show';
  }
  return warningKey;
}

export interface ParkHoursDetails {
  openTimeText: string;
  earlyEntryTimeText: string | null;
  hasEarlyEntry: boolean;
}

export function getParkHoursDetails(parkName: string): ParkHoursDetails {
  switch (parkName) {
    case 'Magic Kingdom':
      return {
        openTimeText: '9:00 AM - 10:00 PM',
        earlyEntryTimeText: '8:30 AM',
        hasEarlyEntry: true,
      };
    case 'EPCOT':
    case 'Epcot':
      return {
        openTimeText: '9:00 AM - 9:00 PM',
        earlyEntryTimeText: '8:30 AM',
        hasEarlyEntry: true,
      };
    case 'Hollywood Studios':
      return {
        openTimeText: '9:00 AM - 9:00 PM',
        earlyEntryTimeText: '8:30 AM',
        hasEarlyEntry: true,
      };
    case 'Animal Kingdom':
      return {
        openTimeText: '8:00 AM - 6:00 PM',
        earlyEntryTimeText: '7:30 AM',
        hasEarlyEntry: true,
      };
    case 'Typhoon Lagoon':
      return {
        openTimeText: '10:00 AM - 5:00 PM',
        earlyEntryTimeText: null,
        hasEarlyEntry: false,
      };
    case 'Blizzard Beach':
      return {
        openTimeText: '10:00 AM - 5:00 PM',
        earlyEntryTimeText: null,
        hasEarlyEntry: false,
      };
    case 'Disney Springs':
      return {
        openTimeText: '10:00 AM - 11:00 PM',
        earlyEntryTimeText: null,
        hasEarlyEntry: false,
      };
    default:
      return {
        openTimeText: '9:00 AM - 9:00 PM',
        earlyEntryTimeText: '8:30 AM',
        hasEarlyEntry: true,
      };
  }
}

export default function TripScheduleScreen({ navigation, route }: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const tripQuery = useQuery<TripDTO, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
  });

  const itemsQuery = useQuery<readonly PlannedItemDTO[], ApiError>({
    queryKey: tripPlannedListKeys.items(tripId),
    queryFn: () => apiRequest<readonly PlannedItemDTO[]>('GET', `/trips/${tripId}/planned-items`),
  });

  const catalogQuery = useQuery<{ experiences: readonly ExperienceDTO[] }, ApiError>({
    queryKey: ['catalog', 'all'],
    queryFn: async () => {
      try {
        const res = await apiRequest<{ experiences: readonly ExperienceDTO[] }>('GET', '/catalog');
        return res ?? { experiences: [] };
      } catch {
        return { experiences: [] };
      }
    },
  });

  const catalogMap = new Map<string, ExperienceDTO>(
    (catalogQuery.data?.experiences ?? []).map((exp) => [exp.id, exp])
  );

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PlannedItemDTO | null>(null);
  const [draftItem, setDraftItem] = useState<PlannedItemDTO | null>(null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addedScheduleCounts, setAddedScheduleCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  const [walkingSpeed, setWalkingSpeed] = useState<WalkingSpeed>('moderate');
  const [earlyEntryEligible, setEarlyEntryEligible] = useState<boolean>(false);
  const [dayHoursMap, setDayHoursMap] = useState<Record<string, DayTouringHoursDTO>>({});

  const [passTimeText, setPassTimeText] = useState<string>('');
  const [timeError, setTimeError] = useState<string | null>(null);

  React.useEffect(() => {
    if (tripQuery.data) {
      if (tripQuery.data.walkingSpeed) setWalkingSpeed(tripQuery.data.walkingSpeed);
      if (tripQuery.data.earlyEntryEligible !== undefined) setEarlyEntryEligible(tripQuery.data.earlyEntryEligible);
      if (tripQuery.data.dayTouringHours) setDayHoursMap(tripQuery.data.dayTouringHours);
    }
  }, [tripQuery.data]);

  React.useEffect(() => {
    if (selectedDate === null && tripQuery.data?.startDate) {
      const futureDates = generateDateRange(tripQuery.data.startDate, tripQuery.data.endDate, true);
      setSelectedDate(futureDates.length > 0 ? futureDates[0]! : tripQuery.data.startDate);
    }
  }, [selectedDate, tripQuery.data?.startDate, tripQuery.data?.endDate]);

  const tripPatchMutation = useMutation<TripDTO, ApiError, TripEditInput>({
    mutationFn: (body) => apiRequest<TripDTO>('PATCH', `/trips/${tripId}`, body),
    onSuccess: (updated) => {
      if (updated.walkingSpeed) setWalkingSpeed(updated.walkingSpeed);
      if (updated.earlyEntryEligible !== undefined) setEarlyEntryEligible(updated.earlyEntryEligible);
      if (updated.dayTouringHours) setDayHoursMap(updated.dayTouringHours);
      void queryClient.invalidateQueries({
        queryKey: tripDetailKeys.detail(tripId),
      });
    },
  });

  const addMutation = useMutation<
    PlannedItemDTO,
    ApiError,
    | { experienceId: string; plannedDate?: string }
    | { itemType: 'break'; customTitle?: string; durationMinutes?: number; plannedDate?: string }
  >({
    mutationFn: (body) => apiRequest<PlannedItemDTO>('POST', `/trips/${tripId}/planned-items`, body),
    onSuccess: (_data, variables) => {
      if ('experienceId' in variables && variables.experienceId) {
        setAddedScheduleCounts((prev) => {
          const next = new Map(prev);
          next.set(variables.experienceId, (next.get(variables.experienceId) ?? 0) + 1);
          return next;
        });
      }
      optimizeMutation.reset();
      void queryClient.invalidateQueries({
        queryKey: tripPlannedListKeys.items(tripId),
      });
    },
  });

  const handleOpenAddModal = () => {
    setAddedScheduleCounts(new Map());
    setShowAddModal(true);
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
    setAddedScheduleCounts(new Map());
  };

  const editMutation = useMutation<void, ApiError, { itemId: string; body: PlannedItemEditInput }>({
    mutationFn: async ({ itemId, body }) => {
      await apiRequest('PATCH', `/trips/${tripId}/planned-items/${itemId}`, body);
    },
    onSuccess: () => {
      setEditingItem(null);
      setDraftItem(null);
      optimizeMutation.reset();
      void queryClient.invalidateQueries({
        queryKey: tripPlannedListKeys.items(tripId),
      });
    },
    onError: (err) => {
      setTimeError(err.message || 'Failed to save changes');
    },
  });

  const deleteMutation = useMutation<void, ApiError, string>({
    mutationFn: async (itemId) => {
      await apiRequest('DELETE', `/trips/${tripId}/planned-items/${itemId}`);
    },
    onSuccess: () => {
      setEditingItem(null);
      setDraftItem(null);
      optimizeMutation.reset();
      void queryClient.invalidateQueries({
        queryKey: tripPlannedListKeys.items(tripId),
      });
    },
  });

  const optimizeMutation = useMutation<TripOptimizationResult, ApiError, { date: string; startHour?: number; endHour?: number } | string>({
    mutationFn: async (input) => {
      const body = typeof input === 'string' ? { date: input } : input;
      return apiRequest<TripOptimizationResult>('POST', `/trips/${tripId}/schedule/optimize`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: tripPlannedListKeys.items(tripId),
      });
    },
  });

  const items = itemsQuery.data ?? [];
  const activeDate = selectedDate ?? tripQuery.data?.startDate ?? 'No Date';
  const tripDates = generateDateRange(tripQuery.data?.startDate, tripQuery.data?.endDate, true);

  const activeDaySettings: DayTouringHoursDTO = (activeDate !== 'No Date' && dayHoursMap[activeDate]) || {};
  const currentStartHour = activeDaySettings.startHour ?? 9;
  const currentEndHour = activeDaySettings.endHour ?? 21;
  const currentUseEarlyEntry = activeDaySettings.useEarlyEntry ?? earlyEntryEligible;
  const currentUseExtendedEvening = activeDaySettings.useExtendedEvening ?? false;
  const currentHasAfterHoursTicket = activeDaySettings.hasAfterHoursTicket ?? false;

  const setDaySetting = (updates: Partial<DayTouringHoursDTO>) => {
    if (activeDate === 'No Date') return;
    setDayHoursMap((prev) => ({
      ...prev,
      [activeDate]: {
        startHour: currentStartHour,
        endHour: currentEndHour,
        useEarlyEntry: currentUseEarlyEntry,
        useExtendedEvening: currentUseExtendedEvening,
        hasAfterHoursTicket: currentHasAfterHoursTicket,
        ...(activeDaySettings.startingPark ? { startingPark: activeDaySettings.startingPark } : {}),
        ...prev[activeDate],
        ...updates,
      },
    }));
  };

  const handleSaveScheduleSettings = () => {
    const updatedMap = {
      ...dayHoursMap,
      ...(activeDate !== 'No Date'
        ? {
            [activeDate]: {
              startHour: currentStartHour,
              endHour: currentEndHour,
              useEarlyEntry: currentUseEarlyEntry,
              useExtendedEvening: currentUseExtendedEvening,
              hasAfterHoursTicket: currentHasAfterHoursTicket,
              ...(activeDaySettings.startingPark ? { startingPark: activeDaySettings.startingPark } : {}),
            },
          }
        : {}),
    };
    setDayHoursMap(updatedMap);
    tripPatchMutation.mutate({
      walkingSpeed,
      earlyEntryEligible,
      dayTouringHours: updatedMap,
    });
    setShowSettingsModal(false);
  };

  const activeDateNorm = normalizeDateStr(activeDate);
  const dayItems = items.filter((i) => normalizeDateStr(i.plannedDate) === activeDateNorm);
  const unassignedItems = items.filter((i) => !i.plannedDate);

  const scheduledDayItems = dayItems
    .filter((i) => i.plannedTime)
    .sort((a, b) => (a.plannedTime ?? '').localeCompare(b.plannedTime ?? ''));
  const unscheduledDayItems = dayItems.filter((i) => !i.plannedTime);

  const optResult = optimizeMutation.data;
  const activeDayParks = [...new Set(dayItems.map((i) => i.park).filter((p): p is import('@dwt/shared').Park => p != null))];

  // R8.2 / R8.3: a day is "optimized" if it was just optimized this session
  // (`optResult`) or its scheduled items carry a persisted optimization result
  // (`optimizedAt`). When it has never been optimized we show a notice and omit
  // wait pills rather than fabricating placeholder numbers.
  const persistedOptimizedAt = scheduledDayItems
    .map((i) => i.optimizedAt)
    .filter((t): t is string => t != null);
  const dayIsOptimized = Boolean(optResult) || persistedOptimizedAt.length > 0;
  const lastOptimizedAt =
    persistedOptimizedAt.length > 0
      ? persistedOptimizedAt.reduce((a, b) => (a > b ? a : b))
      : null;

  const editingExpInfo = draftItem?.experienceId ? catalogMap.get(draftItem.experienceId) : undefined;
  const isEditingShowOrParade = Boolean(
    editingExpInfo?.category === 'Show' || editingExpInfo?.category === 'Parade'
  );
  const isEditingRideOrMeet = Boolean(
    editingExpInfo?.category === 'Ride' || editingExpInfo?.category === 'Character_Meet'
  );
  const isAttraction = Boolean(
    isEditingShowOrParade ||
      isEditingRideOrMeet ||
      (!editingExpInfo && draftItem?.itemType !== 'break' && !draftItem?.servedMealPeriods?.length && draftItem?.mealPeriod == null)
  );

  const isEditingRestaurant = Boolean(
    editingExpInfo?.category === 'Restaurant' ||
      (draftItem?.servedMealPeriods && draftItem.servedMealPeriods.length > 0) ||
      (!isAttraction && (draftItem?.itemType === 'break' || draftItem?.mealPeriod != null))
  );

  const isEditingBreak = Boolean(draftItem?.itemType === 'break');
  const isEditingRideLike = Boolean(
    draftItem && !isEditingBreak && (editingExpInfo?.category === 'Ride' || editingExpInfo?.category === 'Character_Meet')
  );
  const isEligibleForLightningLane = Boolean(
    draftItem &&
      !isEditingBreak &&
      !isEditingRestaurant &&
      (isAttraction || !editingExpInfo?.category)
  );
  const isEligibleForSingleRider = Boolean(
    draftItem &&
      !isEditingBreak &&
      (editingExpInfo?.category === 'Ride' || (!editingExpInfo?.category && isEditingRideLike))
  );
  const targetDateForModal = normalizeDateStr(draftItem?.plannedDate) ?? normalizeDateStr(activeDate);
  const targetParkForModal = draftItem?.park ?? editingExpInfo?.park ?? 'Magic Kingdom';

  // `GET /crowd-calendar` responds with `{ days: [...] }`, not a bare array — see
  // `CrowdCalendarScreen`, which consumes the same endpoint. Unwrapping `days` is
  // required; indexing the envelope directly yields `undefined` and silently
  // renders as "showtimes not published yet" even when patterns exist.
  const crowdCalendarQuery = useQuery<readonly CrowdCalendarDayDTO[], ApiError>({
    queryKey: ['crowd-calendar', targetParkForModal, targetDateForModal],
    queryFn: async () => {
      if (!targetDateForModal) return [];
      const res = await apiRequest<{ readonly days: readonly CrowdCalendarDayDTO[] }>(
        'GET',
        `/crowd-calendar?park=${encodeURIComponent(targetParkForModal)}&from=${targetDateForModal}&to=${targetDateForModal}`
      );
      return res?.days ?? [];
    },
    enabled: Boolean(editingItem && isEditingShowOrParade && targetDateForModal),
  });

  const showtimesList: readonly string[] = React.useMemo(() => {
    if (!isEditingShowOrParade || !crowdCalendarQuery.data || crowdCalendarQuery.data.length === 0) {
      return [];
    }
    const day = crowdCalendarQuery.data[0];
    const sig = day?.rideSignals?.find((r) => r.experienceId === draftItem?.experienceId);
    return sig?.showtimes ?? [];
  }, [isEditingShowOrParade, crowdCalendarQuery.data, draftItem?.experienceId]);

  const handleQuickEdit = (item: PlannedItemDTO, partial: Partial<PlannedItemEditInput>) => {
    const rawDate = partial.plannedDate !== undefined ? partial.plannedDate : item.plannedDate;
    const normDate = normalizeDateStr(rawDate);
    const body: PlannedItemEditInput = {
      ...(normDate ? { plannedDate: normDate } : {}),
      ...(item.plannedTime ? { plannedTime: item.plannedTime } : {}),
      isFixed: item.isFixed ?? false,
      isLightningLane: item.isLightningLane ?? false,
      useSingleRider: item.useSingleRider ?? false,
      priority: item.priority ?? 2,
      itemType: item.itemType ?? 'experience',
      ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
      ...partial,
    };
    if (partial.plannedDate === null) {
      body.plannedDate = null;
    }
    editMutation.mutate({
      itemId: item.id,
      body,
    });
  };

  function getEffectiveDefaultDuration(item: PlannedItemDTO | null, exp: ExperienceDTO | undefined): number {
    if (!item) return 15;
    if (item.durationMinutes != null) return item.durationMinutes;
    if (item.itemType === 'break') return 60;
    if (exp?.category === 'Restaurant') {
      const sub = (exp.subType ?? '').toLowerCase();
      if (sub.includes('quick service') || sub.includes('counter')) return 30;
      if (sub.includes('signature') || sub.includes('fine')) return 90;
      return 60;
    }
    if (exp?.category === 'Show' || exp?.category === 'Parade') {
      return 30;
    }
    if (
      exp?.category === 'Resort' ||
      exp?.category === 'Recreation' ||
      exp?.category === 'Spa' ||
      exp?.category === 'Tour' ||
      exp?.category === 'Event'
    ) {
      return 60;
    }
    return 15;
  }

  type TimingMode = 'any_time' | 'soft_window' | 'exact_time';
  const [timingMode, setTimingMode] = useState<TimingMode>('any_time');
  const [selectedMealPeriod, setSelectedMealPeriod] = useState<MealPeriod | null>(null);
  const [windowStartMins, setWindowStartMins] = useState<number | null>(null);
  const [windowEndMins, setWindowEndMins] = useState<number | null>(null);
  const [draftCustomTitle, setDraftCustomTitle] = useState<string>('');
  const [draftDuration, setDraftDuration] = useState<number | null>(null);

  const openEditModal = (item: PlannedItemDTO) => {
    setEditingItem(item);
    setDraftItem({ ...item });
    setDraftCustomTitle(item.customTitle ?? '');
    setDraftDuration(item.durationMinutes ?? null);
    if (item.isFixed || item.isLightningLane) {
      setTimingMode('exact_time');
      setSelectedMealPeriod(null);
      setWindowStartMins(null);
      setWindowEndMins(null);
      setPassTimeText(item.plannedTime ? formatTimeDisplay(item.plannedTime) : '');
    } else if (item.mealPeriod || item.windowStartMinutes != null || item.windowEndMinutes != null) {
      setTimingMode('soft_window');
      setSelectedMealPeriod(item.mealPeriod ?? null);
      setWindowStartMins(item.windowStartMinutes ?? null);
      setWindowEndMins(item.windowEndMinutes ?? null);
      setPassTimeText('');
    } else {
      setTimingMode('any_time');
      setSelectedMealPeriod(null);
      setWindowStartMins(null);
      setWindowEndMins(null);
      setPassTimeText('');
    }
    setTimeError(null);
  };

  const handleSaveModal = () => {
    if (!draftItem || !editingItem) {
      setEditingItem(null);
      setDraftItem(null);
      return;
    }

    const expInfo = draftItem.experienceId ? catalogMap.get(draftItem.experienceId) : undefined;
    const isShowOrParade = Boolean(
      expInfo?.category === 'Show' || expInfo?.category === 'Parade'
    );
    const isRideOrMeet = Boolean(
      expInfo?.category === 'Ride' || expInfo?.category === 'Character_Meet'
    );
    const isAttractionExp = Boolean(
      isShowOrParade ||
        isRideOrMeet ||
        (!expInfo && draftItem.itemType !== 'break' && !draftItem.servedMealPeriods?.length && draftItem.mealPeriod == null)
    );
    const isRestaurant = Boolean(
      expInfo?.category === 'Restaurant' ||
        (draftItem?.servedMealPeriods && draftItem.servedMealPeriods.length > 0) ||
        (!isAttractionExp && (draftItem?.itemType === 'break' || draftItem?.mealPeriod != null))
    );
    const isBreak = draftItem.itemType === 'break';
    const isLLAllowed = !isBreak && !isRestaurant;
    const isSingleRiderAllowed = !isBreak && (expInfo?.category === 'Ride' || (!expInfo?.category && (draftItem.useSingleRider ?? false)));

    const origTimingMode: TimingMode =
      editingItem.isFixed || editingItem.isLightningLane
        ? 'exact_time'
        : editingItem.mealPeriod || editingItem.windowStartMinutes != null || editingItem.windowEndMinutes != null
        ? 'soft_window'
        : 'any_time';

    const targetDate = normalizeDateStr(draftItem.plannedDate) ?? normalizeDateStr(activeDate) ?? '2026-08-20';
    let exactTimeIso: string | null = null;
    if (timingMode === 'exact_time' && passTimeText.trim()) {
      exactTimeIso = parseTimeInputToIso(passTimeText, targetDate);
      if (!exactTimeIso) {
        setTimeError('Enter time as HH:MM AM/PM (e.g. 10:30 AM)');
        return;
      }
    }

    // Check if any fields changed compared to the original item before modal opened
    let hasTimingChanged = false;
    if (timingMode !== origTimingMode) {
      hasTimingChanged = true;
    } else if (timingMode === 'exact_time') {
      const origLL = Boolean(editingItem.isLightningLane);
      const newLL = isLLAllowed ? Boolean(draftItem.isLightningLane) : false;
      const origIsoTimeStr = editingItem.plannedTime ? formatTimeDisplay(editingItem.plannedTime) : '';
      const newIsoTimeStr = passTimeText.trim() ? formatTimeDisplay(exactTimeIso) : '';
      if (origLL !== newLL || origIsoTimeStr !== newIsoTimeStr) {
        hasTimingChanged = true;
      }
    } else if (timingMode === 'soft_window') {
      const origMeal = editingItem.mealPeriod ?? null;
      const newMeal = isRestaurant ? (selectedMealPeriod ?? null) : null;
      const origStart = editingItem.windowStartMinutes ?? null;
      const origEnd = editingItem.windowEndMinutes ?? null;
      const newStart = windowStartMins ?? null;
      const newEnd = windowEndMins ?? null;
      if (origMeal !== newMeal || origStart !== newStart || origEnd !== newEnd) {
        hasTimingChanged = true;
      }
    }

    const normDate = normalizeDateStr(draftItem.plannedDate);
    const origDate = normalizeDateStr(editingItem.plannedDate);
    const hasDateChanged = normDate !== origDate;

    const newPriority = draftItem.priority ?? 2;
    const origPriority = editingItem.priority ?? 2;
    const hasPriorityChanged = newPriority !== origPriority;

    const newSingleRider = isSingleRiderAllowed ? Boolean(draftItem.useSingleRider) : false;
    const origSingleRider = Boolean(editingItem.useSingleRider);
    const hasSingleRiderChanged = newSingleRider !== origSingleRider;

    const newCustomTitle = draftItem.itemType === 'break' ? (draftCustomTitle.trim() || null) : null;
    const origCustomTitle = editingItem.customTitle || null;
    const hasCustomTitleChanged = newCustomTitle !== origCustomTitle;

    const newDuration = !isAttractionExp && draftDuration != null ? draftDuration : null;
    const origDuration = editingItem.durationMinutes ?? null;
    const hasDurationChanged = newDuration !== origDuration;

    const hasAnyChange =
      hasTimingChanged ||
      hasDateChanged ||
      hasPriorityChanged ||
      hasSingleRiderChanged ||
      hasCustomTitleChanged ||
      hasDurationChanged;

    if (!hasAnyChange) {
      setEditingItem(null);
      setDraftItem(null);
      return;
    }

    const body: PlannedItemEditInput = {
      ...(draftItem.plannedDate !== undefined ? { plannedDate: normDate } : {}),
      useSingleRider: newSingleRider,
      priority: newPriority,
      itemType: draftItem.itemType ?? 'experience',
      ...(!isAttractionExp && draftDuration != null ? { durationMinutes: draftDuration } : {}),
      ...(draftItem.itemType === 'break' ? { customTitle: draftCustomTitle.trim() || null } : {}),
    };

    if (timingMode === 'any_time') {
      if (origTimingMode !== 'any_time') {
        body.plannedTime = null;
        body.isFixed = false;
        body.isLightningLane = false;
        body.windowStartMinutes = null;
        body.windowEndMinutes = null;
        body.mealPeriod = null;
      }
    } else if (timingMode === 'soft_window') {
      body.plannedTime = null;
      body.isFixed = false;
      body.isLightningLane = false;
      body.mealPeriod = isRestaurant ? selectedMealPeriod : null;
      body.windowStartMinutes = windowStartMins;
      body.windowEndMinutes = windowEndMins;
    } else if (timingMode === 'exact_time') {
      body.plannedTime = exactTimeIso;
      body.isLightningLane = isLLAllowed ? (draftItem.isLightningLane ?? false) : false;
      body.isFixed = !body.isLightningLane;
      body.windowStartMinutes = null;
      body.windowEndMinutes = null;
      body.mealPeriod = null;
    }

    editMutation.mutate({
      itemId: draftItem.id,
      body,
    });
  };

  const handleSelectExperience = (exp: ExperienceDTO) => {
    addMutation.mutate({
      experienceId: exp.id,
      ...(activeDate !== 'No Date' ? { plannedDate: activeDate } : {}),
    });
  };

  const handleSelectUnlocatedBreak = (customTitle: string, durationMinutes: number, experienceId?: string | null) => {
    addMutation.mutate({
      itemType: 'break',
      customTitle,
      durationMinutes,
      ...(experienceId ? { experienceId } : {}),
      ...(activeDate !== 'No Date' ? { plannedDate: activeDate } : {}),
    });
  };

  return (
    <ScreenContainer>
      <GradientHeader
        title="Schedule Builder"
        icon="calendar"
        compact
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            testID="schedule-settings-btn"
            onPress={() => setShowSettingsModal(true)}
            style={styles.headerSettingsBtn}
          >
            <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
          </Pressable>
        }
      />

      {(tripQuery.isLoading || itemsQuery.isLoading) ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : (tripQuery.isError || itemsQuery.isError) ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load the schedule"
            body="There was a problem loading your trip details."
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tripQuery.refetch();
              void itemsQuery.refetch();
            }}
          />
        </View>
      ) : (
        <>
          <View style={styles.dateSelectorContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateSelector}>
              {tripDates.map((dateStr) => {
                const isSelected = dateStr === activeDate;
                return (
                  <Pressable
                    key={dateStr}
                    testID={`date-pill-${dateStr}`}
                    style={[styles.datePill, isSelected && styles.datePillActive]}
                    onPress={() => setSelectedDate(dateStr)}
                  >
                    <Text style={[styles.datePillText, isSelected && styles.datePillTextActive]}>
                      {formatDatePill(dateStr)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.actionBar}>
            <SecondaryButton
              label={`+ Add to ${formatDatePill(activeDate)}`}
              icon="add-circle-outline"
              onPress={handleOpenAddModal}
            />
            <PrimaryButton
              label={optimizeMutation.isPending ? 'Optimizing...' : '✨ Optimize'}
              onPress={() => {
                if (activeDate !== 'No Date') {
                  optimizeMutation.mutate({
                    date: activeDate,
                    startHour: currentStartHour,
                    endHour: currentEndHour,
                  });
                }
              }}
              disabled={optimizeMutation.isPending}
            />
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {/* Park Operating Hours Horizontal Scroll Row */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.parkHoursRowScroll}>
              {(activeDayParks.length > 0 ? activeDayParks : ['Animal Kingdom', 'Epcot']).map((parkName, pIdx) => {
                const accentColors = ['#22c55e', '#0284c7', '#a855f7', '#f97316'];
                const accentColor = accentColors[pIdx % accentColors.length]!;
                const parkDetails = getParkHoursDetails(parkName);
                const showEarlyEntry = (currentUseEarlyEntry || (tripQuery.data?.earlyEntryEligible ?? false)) && parkDetails.hasEarlyEntry;
                return (
                  <View key={parkName} style={[styles.parkHoursCardHorizontal, { borderLeftColor: accentColor }]}>
                    <Text style={styles.parkHoursTitleHoriz}>{parkName}</Text>
                    <Text style={styles.parkHoursTimeHoriz}>
                      {parkDetails.openTimeText}
                    </Text>
                    <View style={styles.parkTagRowHoriz}>
                      {showEarlyEntry && parkDetails.earlyEntryTimeText && (
                        <View style={styles.earlyEntryBadge}>
                          <Text style={styles.earlyEntryBadgeText}>Early Entry {parkDetails.earlyEntryTimeText}</Text>
                        </View>
                      )}
                      {currentUseExtendedEvening && (
                        <View style={styles.extendedHoursBadge}>
                          <Text style={styles.extendedHoursBadgeText}>Extended Hours 11 PM</Text>
                        </View>
                      )}
                      {currentHasAfterHoursTicket && (
                        <View style={styles.afterHoursBadge}>
                          <Text style={styles.afterHoursBadgeText}>After-Hours Event</Text>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* Optimized / Scheduled Itinerary Timeline */}
            {(optResult || scheduledDayItems.length > 0) ? (
              <View style={styles.timelineSectionContainer}>
                <Text style={styles.sectionTitle}>{formatDatePill(activeDate)} Itinerary</Text>

                {/* R8.2 / R8.3: show when the day was last optimized, or a
                    notice that it has not been optimized yet (no fake waits). */}
                {dayIsOptimized ? (
                  lastOptimizedAt && (
                    <Text style={styles.lastOptimizedHint} testID="last-optimized-hint">
                      Last optimized {formatLastOptimized(lastOptimizedAt)}
                    </Text>
                  )
                ) : (
                  <Text style={styles.notOptimizedNotice} testID="not-optimized-notice">
                    Not optimized yet — tap Optimize Day to build your plan and see predicted waits.
                  </Text>
                )}

                {optResult && optResult.warnings.length > 0 && (
                  <View style={styles.warnings}>
                    {optResult.warnings.map((w: string, i: number) => (
                      <Text key={i} style={styles.warningText}>
                        • {formatOptimizationWarning(w, items)}
                      </Text>
                    ))}
                  </View>
                )}

                <View style={styles.timelineWrapper}>
                  {/* Thin Vertical Track Line */}
                  <View style={styles.verticalTrackLine} />

                  {(optResult ? optResult.items.map((optItem) => {
                    const matched = items.find((d) => d.id === optItem.plannedItemId);
                    return matched ? { item: matched, suggestedArrival: optItem.suggestedArrival, predictedWaitMinutes: optItem.predictedWaitMinutes, travelFromPrev: optItem.travelFromPrev } : null;
                  }).filter(Boolean) : scheduledDayItems.map((item) => {
                    // R8.2/R8.3: render the persisted optimization result; never
                    // fabricate placeholder wait/travel. Null means "not optimized".
                    return {
                      item,
                      suggestedArrival: item.plannedTime,
                      predictedWaitMinutes: item.predictedWaitMinutes,
                      travelFromPrev: item.travelFromPrev,
                    };
                  })).map((entry, idx) => {
                    if (!entry) return null;
                    const { item, suggestedArrival, predictedWaitMinutes, travelFromPrev } = entry;
                    const expInfo = item.experienceId ? catalogMap.get(item.experienceId) : undefined;
                    const isParkHop = travelFromPrev?.kind === 'park_hop';
                    const travelMins = travelFromPrev?.minutes ?? 0;
                    const timeText = formatTimeDisplay(suggestedArrival);

                    return (
                      <View key={item.id} style={styles.timelineStepContainer}>
                        {/* Travel Connector / Park Hop Dashed Box (only when the
                            optimizer produced a travel leg for this item) */}
                        {travelFromPrev && (
                          <View style={styles.connectorRowContainer}>
                            {isParkHop ? (
                              <View style={styles.parkHopRow}>
                                <View style={styles.busNodeCircle}>
                                  <Ionicons name="bus" size={18} color="#ffffff" />
                                </View>
                                <View style={styles.dashedParkHopBox}>
                                  <Text style={styles.dashedParkHopText}>
                                    <Text style={styles.boldMins}>+{travelMins}m </Text>
                                    {item.park ? (
                                      <>
                                        Park Hop to {item.park}
                                        {getParkHoursDetails(item.park ?? '').openTimeText.includes(' - ')
                                          ? ` (Open til ${getParkHoursDetails(item.park ?? '').openTimeText.split(' - ')[1] ?? '9:00 PM'})`
                                          : ''}
                                      </>
                                    ) : (
                                      `Transit to ${item.experienceName || item.customTitle || 'Break'}`
                                    )}
                                  </Text>
                                </View>
                              </View>
                            ) : (
                              <View style={styles.walkTextRow}>
                                <Ionicons name="walk-outline" size={16} color="#334155" />
                                <Text style={styles.inlineWalkText}>
                                  <Text style={styles.boldMins}>+{travelMins}m </Text>
                                  walk{expInfo?.land ? ` to ${expInfo.land}` : ''}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Speech Bubble Top Node (Item 1 only) */}
                        {idx === 0 && (
                          <View style={styles.topSpeechNodeRow}>
                            <View style={styles.purpleCircleNode} />
                            <View style={styles.speechBubbleWrapper}>
                              <View style={styles.speechBubbleTriangle} />
                              <View style={styles.speechPillPointer}>
                                <Text style={styles.speechPillText}>{timeText}</Text>
                              </View>
                            </View>
                          </View>
                        )}

                        <View style={styles.timelineCardRow}>
                          {/* Vertical Time Digits for Item 2+ */}
                          {idx > 0 && (
                            <View style={styles.verticalTimeBox}>
                              <Text style={styles.vertTimeDigits}>{timeText.replace(/\s*(AM|PM)/i, '')}</Text>
                              <Text style={styles.vertTimeAmpm}>{timeText.includes('PM') ? 'PM' : 'AM'}</Text>
                            </View>
                          )}

                          {/* Attraction Card (Starts flush at X = 72px) */}
                          <Pressable
                            onPress={() => openEditModal(item)}
                            style={styles.mockupAttractionCard}
                          >
                            {expInfo?.imageUrl ? (
                              <Image source={{ uri: expInfo.imageUrl }} style={styles.mockupThumbnail} />
                            ) : (
                              <View style={styles.mockupThumbnailFallback}>
                                <Ionicons
                                  name={item.itemType === 'break' ? 'restaurant-outline' : 'compass-outline'}
                                  size={28}
                                  color="#475569"
                                />
                              </View>
                            )}

                            <View style={styles.mockupCardBody}>
                              <Text style={styles.mockupCardTitle}>{item.customTitle || item.experienceName || 'Planned Item'}</Text>
                              {item.customTitle && (item.experienceName || expInfo?.name) ? (
                                <View style={styles.mockupCardLocationRow} testID={`item-location-${item.id}`}>
                                  <Ionicons name="location-sharp" size={12} color="#64748b" />
                                  <Text style={styles.mockupCardLocationText} numberOfLines={1}>
                                    {item.experienceName || expInfo?.name}{expInfo?.land ? ` • ${expInfo.land}` : ''}
                                  </Text>
                                </View>
                              ) : null}

                              {/* Badges Row */}
                              <View style={styles.mockupBadgeRow}>
                                {predictedWaitMinutes != null &&
                                  item.itemType !== 'break' &&
                                  expInfo?.category !== 'Restaurant' &&
                                  expInfo?.category !== 'Resort' &&
                                  expInfo?.category !== 'Spa' &&
                                  expInfo?.category !== 'Recreation' && (
                                    <View style={styles.waitPillGray}>
                                      <Text style={styles.waitPillText}>Wait: {predictedWaitMinutes} min</Text>
                                    </View>
                                  )}
                                {/* A Reservation is badged by its kind so a real
                                    booking is distinguishable from a time the
                                    member pinned themselves (trip-reservations
                                    R4.3). */}
                                {item.reservationKind != null && (
                                  <View style={styles.reservationPill}>
                                    <Text
                                      style={styles.reservationPillText}
                                      testID={`item-reservation-badge-${item.id}`}
                                    >
                                      {reservationBadgeLabel(item.reservationKind)}
                                    </Text>
                                  </View>
                                )}
                                <View style={styles.durationPillGray}>
                                  <Text style={styles.durationPillText}>
                                    {/* An off-property booking is stored as a break,
                                        but must never be presented as one (R5.2). */}
                                    {item.reservationKind === 'dining'
                                      ? `🍽️ ${item.durationMinutes || 60}m dining`
                                      : item.itemType === 'break' && item.reservationKind != null
                                      ? `🎟️ ${item.durationMinutes || 60}m reserved`
                                      : item.itemType === 'break'
                                      ? `☕ ${item.durationMinutes || 45}m break`
                                      : expInfo?.category === 'Restaurant'
                                      ? `🍽️ ${item.durationMinutes || 60}m dining`
                                      : `🎢 ${item.durationMinutes || 15}m duration`}
                                  </Text>
                                </View>
                                {item.mealPeriod === 'breakfast' && (
                                  <View style={styles.windowPillOrange}>
                                    <Text style={styles.windowPillText}>🍳 Breakfast ({getMealWindowLabel('breakfast')})</Text>
                                  </View>
                                )}
                                {item.mealPeriod === 'lunch' && (
                                  <View style={styles.windowPillOrange}>
                                    <Text style={styles.windowPillText}>🥗 Lunch ({getMealWindowLabel('lunch')})</Text>
                                  </View>
                                )}
                                {item.mealPeriod === 'dinner' && (
                                  <View style={styles.windowPillOrange}>
                                    <Text style={styles.windowPillText}>🍽️ Dinner ({getMealWindowLabel('dinner')})</Text>
                                  </View>
                                )}
                                {item.mealPeriod === 'snack' && (
                                  <View style={styles.windowPillOrange}>
                                    <Text style={styles.windowPillText}>
                                      🍿 Snack{item.windowStartMinutes != null && item.windowEndMinutes != null ? ` (${formatMinutesToTime(item.windowStartMinutes)} – ${formatMinutesToTime(item.windowEndMinutes)})` : ''}
                                    </Text>
                                  </View>
                                )}
                                {item.windowStartMinutes != null && item.windowEndMinutes != null && !item.mealPeriod && (
                                  <View style={styles.windowPillOrange}>
                                    <Text style={styles.windowPillText}>
                                      ⏱️ {formatMinutesToTime(item.windowStartMinutes)} – {formatMinutesToTime(item.windowEndMinutes)}
                                    </Text>
                                  </View>
                                )}
                                {item.isLightningLane && (
                                  <View style={styles.llPillGold}>
                                    <Text style={styles.llPillText}>LIGHTNING LANE</Text>
                                  </View>
                                )}
                                {currentUseEarlyEntry && idx === 0 && (
                                  <View style={styles.earlyEntryPillCyan}>
                                    <Text style={styles.earlyEntryPillText}>EARLY ENTRY</Text>
                                  </View>
                                )}
                                {item.useSingleRider && (
                                  <View style={styles.singleRiderPillSky}>
                                    <Text style={styles.singleRiderPillText}>SINGLE RIDER</Text>
                                  </View>
                                )}
                                {item.isFixed && (
                                  <View style={styles.fixedTimePillPurple}>
                                    <Text style={styles.fixedTimePillText}>FIXED TIME</Text>
                                  </View>
                                )}
                                {optResult?.warnings?.includes(`typical_showtimes:${item.id}`) && (
                                  <View style={styles.typicalShowtimeNotice} testID={`typical-showtime-notice-${item.id}`}>
                                    <Text style={styles.typicalShowtimeNoticeText}>
                                      🎭 Estimated showtime based on past schedule
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : unscheduledDayItems.length > 0 ? (
              <View style={styles.resultContainer}>
                <Text style={styles.sectionTitle}>{formatDatePill(activeDate)} Planned Items</Text>
                {unscheduledDayItems.map((item) => (
                  <Card key={item.id} style={styles.itemCard}>
                    <Text style={styles.itemName}>{item.customTitle || item.experienceName || 'Planned Item'}</Text>
                    {item.customTitle && item.experienceName ? (
                      <Text style={styles.itemMeta} testID={`unscheduled-item-location-${item.id}`}>
                        📍 {item.experienceName}
                      </Text>
                    ) : null}
                    <View style={styles.itemProps}>
                      {item.reservationKind != null && (
                        <Badge label={reservationBadgeLabel(item.reservationKind)} color={theme.color.accentDark} />
                      )}
                      {item.isFixed && item.reservationKind == null && <Badge label="Fixed" color={theme.color.primary} />}
                      {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                      {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
                      {item.itemType === 'break' && item.reservationKind == null && <Badge label={`☕ Break (${item.durationMinutes || 45}m)`} color={theme.color.success} />}
                      {item.mealPeriod && <Badge label={`🍽️ ${item.mealPeriod}`} color="#f97316" />}
                      <Badge label={`Priority: ${item.priority ?? 2}`} color={theme.color.textSecondary} />
                    </View>
                    <View style={styles.itemActions}>
                      <SecondaryButton
                        label="Unassign"
                        onPress={() => handleQuickEdit(item, { plannedDate: undefined, plannedTime: undefined })}
                      />
                      <SecondaryButton label="Edit Settings" onPress={() => openEditModal(item)} />
                    </View>
                  </Card>
                ))}
              </View>
            ) : (
              <View style={styles.emptyDayContainer}>
                <EmptyState
                  icon="calendar-outline"
                  title={`No plans for ${formatDatePill(activeDate)} yet`}
                  body="Tap + Add to build your schedule."
                />
              </View>
            )}

            {/* Unscheduled Items for Day */}
            {!optResult && scheduledDayItems.length > 0 && unscheduledDayItems.length > 0 && (
              <View style={styles.resultContainer}>
                <Text style={styles.sectionTitle}>Unscheduled for {formatDatePill(activeDate)}</Text>
                {unscheduledDayItems.map((item) => (
                  <Card key={item.id} style={styles.itemCard}>
                    <Text style={styles.itemName}>{item.customTitle || item.experienceName || 'Planned Item'}</Text>
                    {item.customTitle && item.experienceName ? (
                      <Text style={styles.itemMeta} testID={`unscheduled-day-item-location-${item.id}`}>
                        📍 {item.experienceName}
                      </Text>
                    ) : null}
                    <View style={styles.itemProps}>
                      {item.reservationKind != null && (
                        <Badge label={reservationBadgeLabel(item.reservationKind)} color={theme.color.accentDark} />
                      )}
                      {item.isFixed && item.reservationKind == null && <Badge label="Fixed" color={theme.color.primary} />}
                      {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                      {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
                      {item.itemType === 'break' && item.reservationKind == null && <Badge label={`☕ Break (${item.durationMinutes || 45}m)`} color={theme.color.success} />}
                      {item.mealPeriod && <Badge label={`🍽️ ${item.mealPeriod}`} color="#f97316" />}
                      <Badge label={`Priority: ${item.priority ?? 2}`} color={theme.color.textSecondary} />
                    </View>
                    <View style={styles.itemActions}>
                      <SecondaryButton
                        label="Unassign"
                        onPress={() => handleQuickEdit(item, { plannedDate: undefined, plannedTime: undefined })}
                      />
                      <SecondaryButton label="Edit Settings" onPress={() => openEditModal(item)} />
                    </View>
                  </Card>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Unassigned Experiences</Text>
            {unassignedItems.length === 0 ? (
              <Text style={styles.emptyText}>All trip experiences are assigned!</Text>
            ) : (
              unassignedItems.map((item) => (
                <Card key={item.id} style={styles.itemCard}>
                  <Text style={styles.itemName}>{item.customTitle || item.experienceName || 'Planned Item'}</Text>
                  {item.customTitle && item.experienceName ? (
                    <Text style={styles.itemMeta} testID={`unassigned-item-location-${item.id}`}>
                      📍 {item.experienceName}
                    </Text>
                  ) : null}
                  <View style={styles.itemProps}>
                    {item.reservationKind != null && (
                      <Badge label={reservationBadgeLabel(item.reservationKind)} color={theme.color.accentDark} />
                    )}
                    {item.isFixed && item.reservationKind == null && <Badge label="Fixed" color={theme.color.primary} />}
                    {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                    {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
                    {item.itemType === 'break' && item.reservationKind == null && <Badge label={`☕ Break (${item.durationMinutes || 45}m)`} color={theme.color.success} />}
                    {item.mealPeriod && <Badge label={`🍽️ ${item.mealPeriod}`} color="#f97316" />}
                    <Badge label={`Priority: ${item.priority ?? 2}`} color={theme.color.textSecondary} />
                  </View>
                  <View style={styles.itemActions}>
                    <SecondaryButton
                      label={`Assign to ${formatDatePill(activeDate)}`}
                      onPress={() => handleQuickEdit(item, { plannedDate: activeDate })}
                    />
                    <SecondaryButton label="Edit Settings" onPress={() => openEditModal(item)} />
                  </View>
                </Card>
              ))
            )}
          </ScrollView>

          <Modal visible={showAddModal} animationType="slide" onRequestClose={handleCloseAddModal}>
            <ScreenContainer>
              <GradientHeader
                title={`Add to ${formatDatePill(activeDate)}`}
                icon="search"
                compact
                onBack={handleCloseAddModal}
                right={
                  <SecondaryButton
                    label="Done"
                    onPress={handleCloseAddModal}
                    testID="schedule-add-done-btn"
                  />
                }
              />
              <View style={styles.modalBody}>
                <ExperiencePicker
                  enabled={showAddModal}
                  onSelect={handleSelectExperience}
                  onSelectUnlocatedBreak={handleSelectUnlocatedBreak}
                  pendingId={
                    addMutation.isPending && addMutation.variables && 'experienceId' in addMutation.variables
                      ? addMutation.variables.experienceId
                      : null
                  }
                  addedCounts={addedScheduleCounts}
                  busy={addMutation.isPending}
                  testIDPrefix="schedule-picker"
                  showParkFilter={true}
                  defaultPark={isKnownPark(activeDaySettings.startingPark) ? activeDaySettings.startingPark : null}
                  fillContainer
                />
              </View>
            </ScreenContainer>
          </Modal>

          {/* Item Settings Modal */}
          <Modal
            visible={editingItem !== null}
            transparent
            animationType="slide"
            onRequestClose={() => {
              setEditingItem(null);
              setDraftItem(null);
            }}
          >
            <View style={styles.modalBg}>
              <View style={styles.modalContent}>
                {draftItem && (
                  <ScrollView>
                    <Text style={styles.modalTitle}>
                      {draftItem.customTitle || draftItem.experienceName || 'Item Settings'}
                    </Text>

                    {draftItem.itemType === 'break' && (
                      <View style={styles.fieldSection}>
                        <Text style={styles.label}>Break Description</Text>
                        <TextInput
                          style={styles.customTitleInput}
                          value={draftCustomTitle}
                          onChangeText={setDraftCustomTitle}
                          placeholder="e.g. Midday Hotel Nap, Pool Time"
                          placeholderTextColor={theme.color.textSecondary}
                          testID="item-custom-title-input"
                        />
                        {(draftItem.experienceName || editingExpInfo?.name) && (
                          <View style={styles.modalLocationBox} testID="item-modal-location">
                            <Ionicons name="location-sharp" size={14} color={theme.color.textSecondary} />
                            <Text style={styles.modalLocationText} numberOfLines={1}>
                              {draftItem.experienceName || editingExpInfo?.name}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Performance Showtimes for Shows & Parades (crowd-calendar R12 / day-planning R13.4) */}
                    {isEditingShowOrParade && (
                      <View style={styles.showtimesSection} testID="showtimes-section">
                        <Text style={styles.label}>Performance Showtimes</Text>
                        <Text style={styles.showtimesSubLabel}>
                          Select a showtime to lock this performance, or choose Auto-fit to let the optimizer pick the best slot.
                        </Text>

                        {crowdCalendarQuery.isLoading ? (
                          <Text style={styles.showtimesLoadingText}>Loading showtimes...</Text>
                        ) : crowdCalendarQuery.isError ? (
                          <View style={styles.emptyShowtimesBox} testID="showtimes-error-state">
                            <Text style={styles.emptyShowtimesText}>
                              We couldn&apos;t load showtimes right now. Please try again.
                            </Text>
                          </View>
                        ) : showtimesList.length === 0 ? (
                          <View style={styles.emptyShowtimesBox} testID="showtimes-empty-state">
                            <Text style={styles.emptyShowtimesText}>
                              Showtimes are not published yet for this date.
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.showtimePillsContainer}>
                            <Pressable
                              style={[
                                styles.showtimePill,
                                (timingMode === 'any_time' || (!draftItem?.isFixed && !draftItem?.plannedTime)) &&
                                  styles.showtimePillActive,
                              ]}
                              onPress={() => {
                                setTimingMode('any_time');
                                setPassTimeText('');
                                setDraftItem((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        plannedTime: null,
                                        isFixed: false,
                                        isLightningLane: false,
                                      }
                                    : null,
                                );
                                setTimeError(null);
                              }}
                              testID="showtime-autofit-pill"
                            >
                              <Text
                                style={[
                                  styles.showtimePillText,
                                  (timingMode === 'any_time' || (!draftItem?.isFixed && !draftItem?.isLightningLane)) &&
                                    styles.showtimePillTextActive,
                                ]}
                              >
                                ✨ Auto-fit best showtime
                              </Text>
                            </Pressable>

                            {showtimesList.map((isoStr) => {
                              const display = formatTimeDisplay(isoStr);
                              const isSelected =
                                timingMode === 'exact_time' &&
                                (draftItem?.plannedTime === isoStr ||
                                  passTimeText.trim().toUpperCase() === display.toUpperCase());

                              return (
                                <Pressable
                                  key={isoStr}
                                  style={[styles.showtimePill, isSelected && styles.showtimePillActive]}
                                  onPress={() => {
                                    setTimingMode('exact_time');
                                    setPassTimeText(display);
                                    setDraftItem((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            plannedTime: isoStr,
                                            isFixed: true,
                                            isLightningLane: false,
                                          }
                                        : null,
                                    );
                                    setTimeError(null);
                                  }}
                                  testID={`showtime-pill-${display.replace(/\s+/g, '-').toLowerCase()}`}
                                >
                                  <Text
                                    style={[
                                      styles.showtimePillText,
                                      isSelected && styles.showtimePillTextActive,
                                    ]}
                                  >
                                    🎭 {display}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}

                    <Text style={styles.label}>Timing & Scheduling Mode</Text>
                    <View style={styles.timingModeRow}>
                      <Pressable
                        style={[styles.timingModeBtn, timingMode === 'any_time' && styles.timingModeBtnActive]}
                        onPress={() => setTimingMode('any_time')}
                        testID="timing-mode-any_time"
                      >
                        <Ionicons
                          name="sparkles"
                          size={16}
                          color={timingMode === 'any_time' ? theme.color.primary : theme.color.textSecondary}
                        />
                        <Text style={[styles.timingModeText, timingMode === 'any_time' && styles.timingModeTextActive]}>
                          Any Time
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.timingModeBtn, timingMode === 'soft_window' && styles.timingModeBtnActive]}
                        onPress={() => setTimingMode('soft_window')}
                        testID="timing-mode-soft_window"
                      >
                        <Ionicons
                          name="time"
                          size={16}
                          color={timingMode === 'soft_window' ? theme.color.primary : theme.color.textSecondary}
                        />
                        <Text style={[styles.timingModeText, timingMode === 'soft_window' && styles.timingModeTextActive]}>
                          Time Window
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.timingModeBtn, timingMode === 'exact_time' && styles.timingModeBtnActive]}
                        onPress={() => {
                          setTimingMode('exact_time');
                          if (!passTimeText.trim()) {
                            if (draftItem?.plannedTime) {
                              setPassTimeText(formatTimeDisplay(draftItem.plannedTime));
                            } else {
                              setPassTimeText('10:00 AM');
                            }
                          }
                        }}
                        testID="timing-mode-exact_time"
                      >
                        <Ionicons
                          name={draftItem?.isLightningLane ? 'flash' : 'lock-closed'}
                          size={16}
                          color={
                            timingMode === 'exact_time'
                              ? draftItem?.isLightningLane
                                ? theme.color.accent
                                : theme.color.primary
                              : theme.color.textSecondary
                          }
                        />
                        <Text style={[styles.timingModeText, timingMode === 'exact_time' && styles.timingModeTextActive]}>
                          {draftItem?.isLightningLane ? '⚡ LL Pass' : 'Exact Time'}
                        </Text>
                      </Pressable>
                    </View>

                    {timingMode === 'any_time' && (
                      <View style={styles.modeInfoBox}>
                        <Text style={styles.modeInfoText}>
                          ✨ The optimizer will automatically place this item at the optimal time to minimize waits and walking.
                        </Text>
                      </View>
                    )}

                    {timingMode === 'soft_window' && (
                      <View style={styles.timeSection}>
                        {isEditingRestaurant && (
                          <>
                            {selectedMealPeriod &&
                              !isMealPeriodServed(draftItem.servedMealPeriods, selectedMealPeriod) && (
                                <View style={styles.unservedWarningBox} testID="unserved-meal-warning">
                                  <Text style={styles.unservedWarningText}>
                                    ⚠️ {selectedMealPeriod.charAt(0).toUpperCase() + selectedMealPeriod.slice(1)} is not listed as a served meal period for this restaurant.
                                  </Text>
                                </View>
                              )}

                            <Text style={styles.subLabel}>Meal Preference Presets</Text>
                            <View style={styles.windowPresetsGrid}>
                              {[
                                {
                                  key: 'breakfast' as MealPeriod,
                                  label: '🍳 Breakfast',
                                  time: getMealWindowLabel('breakfast'),
                                  start: MEAL_WINDOWS.breakfast?.startMinutes ?? 480,
                                  end: MEAL_WINDOWS.breakfast?.endMinutes ?? 630,
                                },
                                {
                                  key: 'lunch' as MealPeriod,
                                  label: '🥗 Lunch',
                                  time: getMealWindowLabel('lunch'),
                                  start: MEAL_WINDOWS.lunch?.startMinutes ?? 690,
                                  end: MEAL_WINDOWS.lunch?.endMinutes ?? 840,
                                },
                                {
                                  key: 'dinner' as MealPeriod,
                                  label: '🍽️ Dinner',
                                  time: getMealWindowLabel('dinner'),
                                  start: MEAL_WINDOWS.dinner?.startMinutes ?? 1020,
                                  end: MEAL_WINDOWS.dinner?.endMinutes ?? 1200,
                                },
                                {
                                  key: 'snack' as MealPeriod,
                                  label: '🍿 Snack',
                                  time: 'Flexible / All Day',
                                  start: null,
                                  end: null,
                                },
                              ].map((mp) => {
                                const isSel =
                                  selectedMealPeriod === mp.key &&
                                  (mp.key === 'snack' ||
                                    (windowStartMins === mp.start && windowEndMins === mp.end));
                                return (
                                  <Pressable
                                    key={mp.key}
                                    style={[styles.windowPresetCard, isSel && styles.windowPresetCardActive]}
                                    onPress={() => {
                                      setSelectedMealPeriod(mp.key);
                                      setWindowStartMins(mp.start);
                                      setWindowEndMins(mp.end);
                                    }}
                                    testID={`meal-period-${mp.key}`}
                                  >
                                    <Text style={[styles.windowPresetTitle, isSel && styles.windowPresetTitleActive]}>
                                      {mp.label}
                                    </Text>
                                    <Text style={[styles.windowPresetSubtitle, isSel && styles.windowPresetSubtitleActive]}>
                                      {mp.time}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>

                            <Text style={styles.subLabel}>Full Service Window Presets</Text>
                            <View style={styles.windowPresetsGrid}>
                              {[
                                {
                                  key: 'breakfast' as MealPeriod,
                                  label: '🍳 Breakfast Service',
                                  time: getMealServiceWindowLabel('breakfast'),
                                  start: MEAL_SERVICE_WINDOWS.breakfast?.startMinutes ?? 420,
                                  end: MEAL_SERVICE_WINDOWS.breakfast?.endMinutes ?? 660,
                                },
                                {
                                  key: 'lunch' as MealPeriod,
                                  label: '🥗 Lunch Service',
                                  time: getMealServiceWindowLabel('lunch'),
                                  start: MEAL_SERVICE_WINDOWS.lunch?.startMinutes ?? 660,
                                  end: MEAL_SERVICE_WINDOWS.lunch?.endMinutes ?? 930,
                                },
                                {
                                  key: 'dinner' as MealPeriod,
                                  label: '🍽️ Dinner Service',
                                  time: getMealServiceWindowLabel('dinner'),
                                  start: MEAL_SERVICE_WINDOWS.dinner?.startMinutes ?? 960,
                                  end: MEAL_SERVICE_WINDOWS.dinner?.endMinutes ?? 1260,
                                },
                              ].map((sp) => {
                                const isSel =
                                  selectedMealPeriod === sp.key &&
                                  windowStartMins === sp.start &&
                                  windowEndMins === sp.end;
                                return (
                                  <Pressable
                                    key={`service-${sp.key}`}
                                    style={[styles.windowPresetCard, isSel && styles.windowPresetCardActive]}
                                    onPress={() => {
                                      setSelectedMealPeriod(sp.key);
                                      setWindowStartMins(sp.start);
                                      setWindowEndMins(sp.end);
                                    }}
                                    testID={`meal-service-${sp.key}`}
                                  >
                                    <Text style={[styles.windowPresetTitle, isSel && styles.windowPresetTitleActive]}>
                                      {sp.label}
                                    </Text>
                                    <Text style={[styles.windowPresetSubtitle, isSel && styles.windowPresetSubtitleActive]}>
                                      {sp.time}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </>
                        )}

                        <Text style={styles.subLabel}>Time of Day Presets{isEditingRestaurant ? ' (Any Item)' : ''}</Text>
                        <View style={styles.presetRow}>
                          {[
                            { label: 'Morning (9-12)', start: 540, end: 720 },
                            { label: 'Midday (11-2)', start: 660, end: 840 },
                            { label: 'Afternoon (1-4)', start: 780, end: 960 },
                            { label: 'Evening (5-8)', start: 1020, end: 1200 },
                          ].map((preset) => {
                            const isSel =
                              selectedMealPeriod === null &&
                              windowStartMins === preset.start &&
                              windowEndMins === preset.end;
                            return (
                              <Pressable
                                key={preset.label}
                                style={[styles.presetChip, isSel && styles.presetChipActive]}
                                onPress={() => {
                                  setSelectedMealPeriod(null);
                                  setWindowStartMins(preset.start);
                                  setWindowEndMins(preset.end);
                                }}
                                testID={`time-of-day-${preset.start}`}
                              >
                                <Text style={[styles.presetChipText, isSel && styles.presetChipTextActive]}>
                                  {preset.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        {/* Custom Window Range with Clamping */}
                        {(() => {
                          const clampMin =
                            selectedMealPeriod && selectedMealPeriod !== 'snack' && MEAL_SERVICE_WINDOWS[selectedMealPeriod]
                              ? MEAL_SERVICE_WINDOWS[selectedMealPeriod]!.startMinutes
                              : currentStartHour * 60;
                          const clampMax =
                            selectedMealPeriod && selectedMealPeriod !== 'snack' && MEAL_SERVICE_WINDOWS[selectedMealPeriod]
                              ? MEAL_SERVICE_WINDOWS[selectedMealPeriod]!.endMinutes
                              : currentEndHour * 60;

                          const currentStart = windowStartMins ?? clampMin;
                          const currentEnd = windowEndMins ?? Math.min(clampMax, currentStart + 120);

                          return (
                            <View style={styles.customWindowBox}>
                              <Text style={styles.subLabel}>Custom Target Range</Text>
                              <View style={styles.stepperRow}>
                                <Text style={styles.stepperLabel}>Start Time:</Text>
                                <View style={styles.stepperControls}>
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = Math.max(clampMin, currentStart - 30);
                                      setWindowStartMins(next);
                                      if (windowEndMins == null || windowEndMins < next) {
                                        setWindowEndMins(Math.min(clampMax, next + 60));
                                      }
                                    }}
                                    testID="stepper-start-minus"
                                  >
                                    <Text style={styles.stepperBtnText}>-30m</Text>
                                  </Pressable>
                                  <Text style={styles.stepperValue} testID="custom-start-val">
                                    {formatMinutesToTime(currentStart)}
                                  </Text>
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = Math.min(clampMax - 15, currentStart + 30);
                                      setWindowStartMins(next);
                                      if (windowEndMins == null || windowEndMins < next) {
                                        setWindowEndMins(Math.min(clampMax, next + 30));
                                      }
                                    }}
                                    testID="stepper-start-plus"
                                  >
                                    <Text style={styles.stepperBtnText}>+30m</Text>
                                  </Pressable>
                                </View>
                              </View>

                              <View style={styles.stepperRow}>
                                <Text style={styles.stepperLabel}>End Time:</Text>
                                <View style={styles.stepperControls}>
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = Math.max(currentStart + 15, currentEnd - 30);
                                      setWindowEndMins(next);
                                      if (windowStartMins == null) {
                                        setWindowStartMins(currentStart);
                                      }
                                    }}
                                    testID="stepper-end-minus"
                                  >
                                    <Text style={styles.stepperBtnText}>-30m</Text>
                                  </Pressable>
                                  <Text style={styles.stepperValue} testID="custom-end-val">
                                    {formatMinutesToTime(currentEnd)}
                                  </Text>
                                  <Pressable
                                    style={styles.stepperBtn}
                                    onPress={() => {
                                      const next = Math.min(clampMax, currentEnd + 30);
                                      setWindowEndMins(next);
                                      if (windowStartMins == null) {
                                        setWindowStartMins(currentStart);
                                      }
                                    }}
                                    testID="stepper-end-plus"
                                  >
                                    <Text style={styles.stepperBtnText}>+30m</Text>
                                  </Pressable>
                                </View>
                              </View>
                            </View>
                          );
                        })()}

                        {windowStartMins != null && windowEndMins != null && (
                          <View style={styles.selectedWindowNotice}>
                            <Text style={styles.selectedWindowText}>
                              Active Window: {formatMinutesToTime(windowStartMins)} – {formatMinutesToTime(windowEndMins)}
                            </Text>
                          </View>
                        )}
                        {selectedMealPeriod === 'snack' && windowStartMins == null && windowEndMins == null && (
                          <View style={styles.selectedWindowNotice}>
                            <Text style={styles.selectedWindowText}>
                              Active Window: Flexible Snack (All Day)
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {timingMode === 'exact_time' && (
                      <View style={styles.timeSection}>
                        {isEligibleForLightningLane && (
                          <View style={styles.exactModeToggleRow}>
                            <Pressable
                              style={[styles.exactModeBtn, !draftItem.isLightningLane && styles.exactModeBtnActive]}
                              onPress={() =>
                                setDraftItem((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        isLightningLane: false,
                                        isFixed: true,
                                      }
                                    : null,
                                )
                              }
                              testID="timing-mode-fixed-lock"
                            >
                              <Ionicons
                                name="lock-closed"
                                size={14}
                                color={!draftItem.isLightningLane ? theme.color.primary : theme.color.textSecondary}
                              />
                              <Text style={[styles.exactModeBtnText, !draftItem.isLightningLane && styles.exactModeBtnTextActive]}>
                                🔒 Fixed Time / Lock
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[styles.exactModeBtn, draftItem.isLightningLane && styles.exactModeBtnActive]}
                              onPress={() =>
                                setDraftItem((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        isLightningLane: true,
                                        isFixed: false,
                                      }
                                    : null,
                                )
                              }
                              testID="timing-mode-lightning-lane"
                            >
                              <Ionicons
                                name="flash"
                                size={14}
                                color={draftItem.isLightningLane ? theme.color.accent : theme.color.textSecondary}
                              />
                              <Text style={[styles.exactModeBtnText, draftItem.isLightningLane && styles.exactModeBtnTextActive]}>
                                ⚡ Lightning Lane (1h Window)
                              </Text>
                            </Pressable>
                          </View>
                        )}

                        <Text style={styles.label}>
                          {draftItem.isLightningLane ? '⚡ Lightning Lane Window Start Time' : '🔒 Reservation / Exact Time'}
                        </Text>

                        {(() => {
                          return (
                            <View style={styles.wheelCard}>
                              <Text style={styles.subLabel}>Quick Presets</Text>
                              <View style={styles.presetRow}>
                                {['9:00 AM', '12:00 PM', '3:00 PM', '6:00 PM'].map((preset) => {
                                  const isSelected = passTimeText.trim().toUpperCase() === preset;
                                  return (
                                    <Pressable
                                      key={preset}
                                      style={[styles.presetChip, isSelected && styles.presetChipActive]}
                                      onPress={() => {
                                        setPassTimeText(preset);
                                        setTimeError(null);
                                      }}
                                    >
                                      <Text style={[styles.presetChipText, isSelected && styles.presetChipTextActive]}>
                                        {preset}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>

                              {/* Shared wheel (trip-reservations task 8.1). The
                                  Schedule Builder keeps 15-minute granularity:
                                  it is choosing a touring preference, not
                                  recording a booking. */}
                              <TimeWheelPicker
                                value={passTimeText}
                                minuteStep={15}
                                onChange={(next) => {
                                  setPassTimeText(next);
                                  setTimeError(null);
                                }}
                                testIDPrefix="schedule-time"
                              />
                            </View>
                          );
                        })()}
                        <View style={styles.timeRow}>
                          <TextInput
                            style={styles.timeInput}
                            placeholder="Custom time (e.g. 10:30 AM)"
                            placeholderTextColor={theme.color.textSecondary}
                            value={passTimeText}
                            onChangeText={(txt: string) => {
                              setPassTimeText(txt);
                              setTimeError(null);
                            }}
                          />
                          {passTimeText.trim() !== '' && (
                            <Pressable
                              style={styles.clearTimeButton}
                              onPress={() => {
                                setPassTimeText('');
                                setTimeError(null);
                              }}
                            >
                              <Ionicons name="close-circle" size={20} color={theme.color.textSecondary} />
                            </Pressable>
                          )}
                        </View>
                        {timeError && <Text style={styles.errorText}>{timeError}</Text>}

                        {draftItem.isLightningLane && passTimeText.trim() !== '' && (
                          (() => {
                            const info = getLLWindowInfo(passTimeText, activeDate);
                            if (!info) return null;
                            return (
                              <View style={styles.llWindowBox} testID="ll-window-info">
                                <Text style={styles.llWindowText}>Return Window: {info.windowStr}</Text>
                                <Text style={styles.llGraceText}>Valid Entry: {info.graceStr} (5m early / 15m late grace)</Text>
                              </View>
                            );
                          })()
                        )}
                      </View>
                    )}

                    {!isAttraction && (
                      <>
                        <Text style={styles.label}>Duration</Text>
                        <View style={styles.chipRow}>
                          {[15, 30, 45, 60, 90, 120].map((d) => {
                            const effectiveDur = draftDuration ?? getEffectiveDefaultDuration(draftItem, editingExpInfo);
                            const isChipActive = effectiveDur === d;
                            return (
                              <Pressable
                                key={d}
                                style={[styles.optionChip, isChipActive && styles.optionChipActive]}
                                onPress={() => setDraftDuration(d)}
                                testID={`duration-chip-${d}`}
                              >
                                <Text style={[styles.optionChipText, isChipActive && styles.optionChipTextActive]}>
                                  {d} min
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </>
                    )}

                    {(isEligibleForLightningLane || isEligibleForSingleRider) && (
                      <>
                        <Text style={styles.label}>Options</Text>
                        <View style={styles.modalActions}>
                          {isEligibleForLightningLane && (
                            <SecondaryButton
                              label={draftItem.isLightningLane ? '⚡ Lightning Lane Pass: Active' : '⚡ Lightning Lane Pass: Off'}
                              onPress={() => {
                                const nextLL = !draftItem.isLightningLane;
                                setDraftItem((prev) => {
                                  if (!prev) return null;
                                  return {
                                    ...prev,
                                    isLightningLane: nextLL,
                                    isFixed: nextLL ? false : (timingMode === 'exact_time'),
                                  };
                                });
                                if (nextLL && timingMode !== 'exact_time') {
                                  setTimingMode('exact_time');
                                  if (!passTimeText.trim()) {
                                    setPassTimeText('10:00 AM');
                                  }
                                }
                              }}
                              testID="ll-option-toggle"
                            />
                          )}
                          {isEligibleForSingleRider && (
                            <SecondaryButton
                              label={draftItem.useSingleRider ? '👤 Single Rider Line: Active' : '👤 Single Rider Line: Off'}
                              onPress={() => setDraftItem((prev) => (prev ? { ...prev, useSingleRider: !prev.useSingleRider } : null))}
                              testID="single-rider-toggle"
                            />
                          )}
                        </View>
                      </>
                    )}

                    <Text style={styles.label}>Priority Level</Text>
                    <View style={styles.chipRow}>
                      {[1, 2, 3].map((p) => (
                        <Pressable
                          key={p}
                          style={[styles.optionChip, draftItem.priority === p && styles.optionChipActive]}
                          onPress={() => setDraftItem((prev) => (prev ? { ...prev, priority: p } : null))}
                        >
                          <Text style={[styles.optionChipText, draftItem.priority === p && styles.optionChipTextActive]}>
                            {p === 1 ? 'Must Do (1)' : p === 2 ? 'Standard (2)' : 'Optional (3)'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.modalFooter}>
                      <SecondaryButton
                        label="Remove from Trip"
                        onPress={() => deleteMutation.mutate(draftItem.id)}
                        disabled={deleteMutation.isPending}
                      />
                      <PrimaryButton
                        label="Done"
                        onPress={handleSaveModal}
                        loading={editMutation.isPending}
                        disabled={editMutation.isPending}
                      />
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </Modal>

          {/* Schedule Settings Modal (Touring Hours, Pace, Early Entry, Parties) */}
          <Modal
            visible={showSettingsModal}
            animationType="slide"
            transparent
            onRequestClose={() => setShowSettingsModal(false)}
            testID="schedule-settings-modal"
          >
            <View style={styles.modalBg}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Settings: {formatDatePill(activeDate)}</Text>
                  <Pressable
                    testID="close-schedule-settings-modal"
                    onPress={() => setShowSettingsModal(false)}
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={24} color={theme.color.textSecondary} />
                  </Pressable>
                </View>

                <ScrollView contentContainerStyle={{ gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
                  <Text style={styles.label}>Walking Pace</Text>
                  <View style={styles.chipRow}>
                    {[
                      { label: '🐢 Slow (50m/min)', val: 'slow' as const },
                      { label: '🚶 Moderate (80m/min)', val: 'moderate' as const },
                      { label: '⚡ Fast (100m/min)', val: 'fast' as const },
                    ].map((p) => (
                      <Pressable
                        key={p.val}
                        testID={`walking-pace-${p.val}`}
                        style={[styles.optionChip, walkingSpeed === p.val && styles.optionChipActive]}
                        onPress={() => setWalkingSpeed(p.val)}
                      >
                        <Text style={[styles.optionChipText, walkingSpeed === p.val && styles.optionChipTextActive]}>
                          {p.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.label}>Special Park Hours & Tickets ({formatDatePill(activeDate)})</Text>
                  <View style={styles.chipRow}>
                    <Pressable
                      testID="toggle-early-entry"
                      style={[styles.optionChip, currentUseEarlyEntry && styles.optionChipActive]}
                      onPress={() => {
                        const nextVal = !currentUseEarlyEntry;
                        setEarlyEntryEligible(nextVal);
                        setDaySetting({ useEarlyEntry: nextVal });
                      }}
                    >
                      <Text style={[styles.optionChipText, currentUseEarlyEntry && styles.optionChipTextActive]}>
                        ⚡ Early Entry (30m Early)
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="toggle-extended-evening"
                      style={[styles.optionChip, currentUseExtendedEvening && styles.optionChipActive]}
                      onPress={() => setDaySetting({ useExtendedEvening: !currentUseExtendedEvening })}
                    >
                      <Text style={[styles.optionChipText, currentUseExtendedEvening && styles.optionChipTextActive]}>
                        🌙 Extended Evening (+2 Hours)
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="toggle-after-hours"
                      style={[styles.optionChip, currentHasAfterHoursTicket && styles.optionChipActive]}
                      onPress={() => setDaySetting({ hasAfterHoursTicket: !currentHasAfterHoursTicket })}
                    >
                      <Text style={[styles.optionChipText, currentHasAfterHoursTicket && styles.optionChipTextActive]}>
                        🎟️ After-Hours Event Ticket
                      </Text>
                    </Pressable>
                  </View>

                  <Text style={[styles.label, { marginTop: theme.spacing.xs }]}>Starting Park</Text>
                  <View style={styles.chipRow}>
                    {[
                      { label: 'Auto-detect', val: undefined },
                      { label: 'Magic Kingdom', val: 'Magic Kingdom' },
                      { label: 'EPCOT', val: 'EPCOT' },
                      { label: 'Hollywood Studios', val: 'Hollywood Studios' },
                      { label: 'Animal Kingdom', val: 'Animal Kingdom' },
                    ].map((parkOpt) => {
                      const isSelected = (activeDaySettings.startingPark === parkOpt.val) || (!activeDaySettings.startingPark && parkOpt.val === undefined);
                      return (
                        <Pressable
                          key={parkOpt.label}
                          testID={`starting-park-${parkOpt.label.toLowerCase().replace(/\s+/g, '-')}`}
                          style={[styles.optionChip, isSelected && styles.optionChipActive]}
                          onPress={() => {
                            const newPark = parkOpt.val;
                            const parkInfo = newPark ? getParkHoursDetails(newPark) : null;
                            const newStartHour = parkInfo ? parseInt(parkInfo.openTimeText.split(':')[0]!, 10) : undefined;
                            setDaySetting({
                              startingPark: newPark,
                              ...(newStartHour !== undefined ? { startHour: newStartHour } : {}),
                            });
                          }}
                        >
                          <Text style={[styles.optionChipText, isSelected && styles.optionChipTextActive]}>
                            {parkOpt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {(() => {
                    const primaryParkName = activeDaySettings.startingPark || activeDayParks[0];
                    const primaryParkInfo = primaryParkName ? getParkHoursDetails(primaryParkName) : null;
                    const primaryParkOpenHour = primaryParkInfo ? parseInt(primaryParkInfo.openTimeText.split(':')[0]!, 10) : 9;
                    const closeHourRaw = primaryParkInfo ? parseInt(primaryParkInfo.openTimeText.split(' - ')[1]?.split(':')[0]!, 10) : 9;
                    const primaryParkCloseHour = closeHourRaw === 12 ? 12 : closeHourRaw + 12;

                    return (
                      <>
                        <Text style={styles.label}>Quick Presets</Text>
                        <View style={styles.chipRow}>
                          <Pressable
                            testID="preset-park-open-close"
                            style={[
                              styles.optionChip,
                              currentStartHour === primaryParkOpenHour && currentEndHour === primaryParkCloseHour && styles.optionChipActive,
                            ]}
                            onPress={() => setDaySetting({ startHour: primaryParkOpenHour, endHour: primaryParkCloseHour })}
                          >
                            <Text
                              style={[
                                styles.optionChipText,
                                currentStartHour === primaryParkOpenHour && currentEndHour === primaryParkCloseHour && styles.optionChipTextActive,
                              ]}
                            >
                              🏰 Park Open to Close
                            </Text>
                          </Pressable>
                          <Pressable
                            testID="preset-morning"
                            style={[
                              styles.optionChip,
                              currentStartHour === primaryParkOpenHour && currentEndHour === 13 && styles.optionChipActive,
                            ]}
                            onPress={() => setDaySetting({ startHour: primaryParkOpenHour, endHour: 13 })}
                          >
                            <Text
                              style={[
                                styles.optionChipText,
                                currentStartHour === primaryParkOpenHour && currentEndHour === 13 && styles.optionChipTextActive,
                              ]}
                            >
                              ☀️ Morning
                            </Text>
                          </Pressable>
                          <Pressable
                            testID="preset-evening"
                            style={[
                              styles.optionChip,
                              currentStartHour === 16 && currentEndHour === primaryParkCloseHour && styles.optionChipActive,
                            ]}
                            onPress={() => setDaySetting({ startHour: 16, endHour: primaryParkCloseHour })}
                          >
                            <Text
                              style={[
                                styles.optionChipText,
                                currentStartHour === 16 && currentEndHour === primaryParkCloseHour && styles.optionChipTextActive,
                              ]}
                            >
                              🌙 Evening
                            </Text>
                          </Pressable>
                        </View>

                        <Text style={[styles.label, { marginTop: theme.spacing.xs }]}>Day Start Time</Text>
                        <View style={styles.chipRow}>
                          {[
                            { label: '7:00 AM', val: 7 },
                            { label: '8:00 AM', val: 8 },
                            { label: '9:00 AM', val: 9 },
                            { label: '10:00 AM', val: 10 },
                            { label: '11:00 AM', val: 11 },
                          ].map((opt) => {
                            const displayLabel = opt.val === primaryParkOpenHour ? `${opt.label} (Open)` : opt.label;
                            return (
                              <Pressable
                                key={opt.val}
                                testID={`start-hour-${opt.val}`}
                                style={[styles.optionChip, currentStartHour === opt.val && styles.optionChipActive]}
                                onPress={() => setDaySetting({ startHour: opt.val })}
                              >
                                <Text style={[styles.optionChipText, currentStartHour === opt.val && styles.optionChipTextActive]}>
                                  {displayLabel}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <Text style={[styles.label, { marginTop: theme.spacing.xs }]}>Day End Time</Text>
                        <View style={styles.chipRow}>
                          {[
                            { label: '1:00 PM', val: 13 },
                            { label: '5:00 PM', val: 17 },
                            { label: '7:00 PM', val: 19 },
                            { label: '9:00 PM', val: 21 },
                            { label: '10:00 PM', val: 22 },
                            { label: '11:00 PM', val: 23 },
                          ].map((opt) => {
                            const displayLabel = opt.val === primaryParkCloseHour ? `${opt.label} (Close)` : opt.label;
                            return (
                              <Pressable
                                key={opt.val}
                                testID={`end-hour-${opt.val}`}
                                style={[styles.optionChip, currentEndHour === opt.val && styles.optionChipActive]}
                                onPress={() => setDaySetting({ endHour: opt.val })}
                              >
                                <Text style={[styles.optionChipText, currentEndHour === opt.val && styles.optionChipTextActive]}>
                                  {displayLabel}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </>
                    );
                  })()}
                </ScrollView>

                <View style={[styles.modalFooter, { marginTop: theme.spacing.md }]}>
                  <PrimaryButton
                    testID="save-schedule-settings-btn"
                    label="Done"
                    onPress={handleSaveScheduleSettings}
                    loading={tripPatchMutation.isPending}
                    disabled={tripPatchMutation.isPending}
                  />
                </View>
              </View>
            </View>
          </Modal>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
  },
  dateSelectorContainer: {
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    paddingVertical: theme.spacing.sm,
  },
  dateSelector: {
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  datePill: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  datePillActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  datePillText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  datePillTextActive: {
    color: theme.color.textOnPrimary,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.color.surface,
    gap: theme.spacing.sm,
  },
  parkHoursRow: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  parkHoursCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  parkHoursHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  parkHoursTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    fontWeight: '700',
  },
  parkHoursTime: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  parkTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  sectionTitle: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
    marginVertical: theme.spacing.md,
  },
  lastOptimizedHint: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.sm,
    fontWeight: '400',
  },
  notOptimizedNotice: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.sm,
    fontWeight: '400',
  },
  resultContainer: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
    zIndex: 2,
  },
  speechBubble: {
    backgroundColor: '#6b21a8',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    minWidth: 78,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  speechBubbleText: {
    ...theme.typography.meta,
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  timelineCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.spacing.md,
  },
  squareThumbnail: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
  },
  thumbnailFallback: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  timelineContent: {
    flex: 1,
  },
  timelineName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    fontWeight: '600',
  },
  timelineSub: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  timelineWait: {
    ...theme.typography.meta,
    color: theme.color.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  parkHoursRowScroll: {
    gap: 12,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  parkHoursCardHorizontal: {
    width: 190,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    borderLeftWidth: 5,
    borderLeftColor: '#22c55e',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  parkHoursTitleHoriz: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  parkHoursTimeHoriz: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    marginBottom: 6,
  },
  parkTagRowHoriz: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  earlyEntryBadge: {
    backgroundColor: '#fef08a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  earlyEntryBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#854d0e',
  },
  extendedHoursBadge: {
    backgroundColor: '#e9d5ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  extendedHoursBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#581c87',
  },
  afterHoursBadge: {
    backgroundColor: '#fecdd3',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  afterHoursBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9f1239',
  },
  timelineSectionContainer: {
    marginBottom: theme.spacing.lg,
  },
  timelineWrapper: {
    position: 'relative',
  },
  timelineStepContainer: {
    marginVertical: 4,
  },
  verticalTrackLine: {
    position: 'absolute',
    left: 20,
    top: 10,
    bottom: 10,
    width: 2,
    backgroundColor: '#cbd5e1',
  },
  connectorRowContainer: {
    marginVertical: 4,
    position: 'relative',
    minHeight: 26,
    justifyContent: 'center',
  },
  parkHopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  busNodeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6b21a8',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    borderWidth: 2,
    borderColor: '#ffffff',
    position: 'absolute',
    left: 2,
    zIndex: 2,
  },
  dashedParkHopBox: {
    flex: 1,
    marginLeft: 52,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  dashedParkHopText: {
    fontSize: 13,
    color: '#334155',
  },
  boldMins: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  walkTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 52,
    gap: 6,
  },
  inlineWalkText: {
    fontSize: 13,
    color: '#475569',
  },
  topSpeechNodeRow: {
    height: 34,
    justifyContent: 'center',
    marginBottom: 4,
    position: 'relative',
  },
  purpleCircleNode: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#6b21a8',
    borderWidth: 2,
    borderColor: '#ffffff',
    position: 'absolute',
    left: 12,
    zIndex: 3,
  },
  speechBubbleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'absolute',
    left: 23,
    zIndex: 4,
  },
  speechBubbleTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderRightWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: '#581c87',
  },
  speechPillPointer: {
    backgroundColor: '#581c87',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  speechPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  timelineCardRow: {
    position: 'relative',
    marginVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  verticalTimeBox: {
    position: 'absolute',
    left: -6,
    width: 52,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f3ff',
    paddingVertical: 2,
    borderRadius: 6,
    zIndex: 5,
  },
  vertTimeDigits: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 17,
  },
  vertTimeAmpm: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    marginTop: -1,
  },
  mockupAttractionCard: {
    marginLeft: 52,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  mockupThumbnail: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  mockupThumbnailFallback: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mockupCardBody: {
    flex: 1,
  },
  cardIndexLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  mockupCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 1,
  },
  mockupCardLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  mockupCardLocationText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
    flexShrink: 1,
  },
  mockupBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  waitPillGray: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  waitPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  llPillGold: {
    backgroundColor: '#fde68a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  llPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  // Reservation kind pill (trip-reservations R4.3). Distinct fill from the
  // Lightning-Lane pill, and always accompanied by its kind in words so the
  // distinction is never carried by color alone.
  reservationPill: {
    backgroundColor: '#ede9fe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  reservationPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5b21b6',
  },
  earlyEntryPillCyan: {
    backgroundColor: '#a5f3fc',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  earlyEntryPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0891b2',
  },
  singleRiderPillSky: {
    backgroundColor: '#bae6fd',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  singleRiderPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369a1',
  },
  fixedTimePillPurple: {
    backgroundColor: '#e9d5ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  fixedTimePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b21a8',
  },
  durationPillGray: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  durationPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  itemCard: {
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  itemName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  itemMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  itemProps: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  itemActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  emptyDayContainer: {
    paddingVertical: theme.spacing.lg,
  },
  emptyText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
    marginBottom: theme.spacing.md,
  },
  warnings: {
    backgroundColor: theme.color.warningSurface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.md,
  },
  warningText: {
    color: theme.color.warningText,
    ...theme.typography.meta,
  },
  modalBody: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.color.background,
    padding: theme.spacing.xl,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: '80%',
  },
  headerSettingsBtn: {
    padding: theme.spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  modalTitle: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
  },
  label: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  modalActions: {
    gap: theme.spacing.sm,
  },
  optionChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  optionChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  optionChipText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  optionChipTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '600',
  },
  modalFooter: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  timeSection: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
    color: theme.color.textPrimary,
    fontSize: 15,
  },
  errorText: {
    ...theme.typography.meta,
    color: theme.color.danger,
    marginTop: theme.spacing.xs,
  },
  llWindowBox: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.accent,
  },
  llWindowText: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  llGraceText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  wheelCard: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  presetRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  presetChip: {
    flex: 1,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  presetChipTextActive: {
    color: theme.color.textOnPrimary,
  },
  wheelGrid: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    height: 140,
  },
  wheelColumn: {
    flex: 1,
    alignItems: 'center',
  },
  wheelColHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  wheelScroll: {
    width: '100%',
  },
  wheelItem: {
    paddingVertical: theme.spacing.xs,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    marginVertical: 1,
  },
  wheelItemActive: {
    backgroundColor: theme.color.primary,
  },
  wheelItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  wheelItemTextActive: {
    color: theme.color.textOnPrimary,
  },
  ampmBox: {
    width: '100%',
    gap: theme.spacing.xs,
    marginTop: 4,
  },
  ampmBtn: {
    paddingVertical: theme.spacing.xs + 2,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  ampmBtnActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  ampmText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  ampmTextActive: {
    color: theme.color.textOnPrimary,
  },
  clearTimeButton: {
    padding: theme.spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  windowPillOrange: {
    backgroundColor: '#ffedd5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  windowPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#c2410c',
  },
  fieldSection: {
    marginBottom: theme.spacing.sm,
  },
  customTitleInput: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: 15,
    color: theme.color.textPrimary,
    marginTop: 4,
  },
  modalLocationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.xs,
  },
  modalLocationText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    flexShrink: 1,
  },
  timingModeRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.sm,
  },
  exactModeToggleRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  exactModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  exactModeBtnActive: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.primary,
    ...theme.shadow.card,
  },
  exactModeBtnText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '500',
    fontSize: 12,
  },
  exactModeBtnTextActive: {
    color: theme.color.textPrimary,
    fontWeight: '700',
  },
  timingModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  timingModeBtnActive: {
    backgroundColor: theme.color.surface,
    ...theme.shadow.card,
  },
  timingModeText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  timingModeTextActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
  modeInfoBox: {
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.sm,
  },
  modeInfoText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    lineHeight: 18,
  },
  windowPresetsGrid: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  windowPresetCard: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  windowPresetCardActive: {
    backgroundColor: '#fff7ed',
    borderColor: '#f97316',
  },
  windowPresetTitle: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  windowPresetTitleActive: {
    color: '#ea580c',
    fontWeight: '700',
  },
  windowPresetSubtitle: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  windowPresetSubtitleActive: {
    color: '#c2410c',
    fontWeight: '600',
  },
  selectedWindowNotice: {
    backgroundColor: '#fef3c7',
    padding: theme.spacing.xs + 2,
    borderRadius: theme.radius.sm,
    marginTop: theme.spacing.xs,
    alignItems: 'center',
  },
  selectedWindowText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  unservedWarningBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.xs,
  },
  unservedWarningText: {
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '600',
  },
  customWindowBox: {
    marginTop: theme.spacing.xs,
    padding: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.spacing.xs,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepperLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  stepperBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  stepperBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  stepperValue: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.primary,
    minWidth: 70,
    textAlign: 'center',
  },
  showtimesSection: {
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  showtimesSubLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  showtimesLoadingText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
    marginTop: theme.spacing.xs,
  },
  emptyShowtimesBox: {
    paddingVertical: theme.spacing.sm,
  },
  emptyShowtimesText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
  },
  showtimePillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  showtimePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.color.surface,
    borderWidth: 1.5,
    borderColor: theme.color.border,
  },
  showtimePillActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  showtimePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  showtimePillTextActive: {
    color: '#ffffff',
  },
  typicalShowtimeNotice: {
    backgroundColor: '#fef3c7',
    borderRadius: theme.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  typicalShowtimeNoticeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#b45309',
  },
});
