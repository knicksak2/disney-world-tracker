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
  type DayTouringHoursDTO,
  type ExperienceDTO,
  type PlannedItemDTO,
  type PlannedItemEditInput,
  type TripDTO,
  type TripEditInput,
  type TripOptimizationResult,
  type WalkingSpeed,
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

const HOURS_12 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const MINUTES_15 = ['00', '15', '30', '45'];
const AMPM_LIST = ['AM', 'PM'];

function parseTimeToWheelState(timeStr: string): { hour: string; minute: string; ampm: string } {
  if (!timeStr.trim()) return { hour: '10', minute: '30', ampm: 'AM' };
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hour: '10', minute: '30', ampm: 'AM' };
  const hNum = parseInt(match[1]!, 10);
  const mStr = match[2]!;
  const ampm = match[3]!.toUpperCase();
  const hourStr = String(hNum % 12 || 12);
  const minStr = MINUTES_15.includes(mStr) ? mStr : '00';
  return { hour: hourStr, minute: minStr, ampm };
}

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
    return item ? `🎭 ${item.experienceName} scheduled for showtime` : '🎭 Scheduled for showtime';
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

  const addMutation = useMutation<PlannedItemDTO, ApiError, { experienceId: string; plannedDate?: string }>({
    mutationFn: (body) => apiRequest<PlannedItemDTO>('POST', `/trips/${tripId}/planned-items`, body),
    onSuccess: () => {
      setShowAddModal(false);
      optimizeMutation.reset();
      void queryClient.invalidateQueries({
        queryKey: tripPlannedListKeys.items(tripId),
      });
    },
  });

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
  const activeDayParks = [...new Set(dayItems.map((i) => i.park))];

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

  const openEditModal = (item: PlannedItemDTO) => {
    setEditingItem(item);
    setDraftItem({ ...item });
    setPassTimeText(item.plannedTime ? formatTimeDisplay(item.plannedTime) : '');
    setTimeError(null);
  };

  const handleSaveModal = () => {
    if (!draftItem) {
      setEditingItem(null);
      setDraftItem(null);
      return;
    }
    let plannedTime: string | null | undefined = draftItem.plannedTime;

    if ((draftItem.isLightningLane || draftItem.isFixed) && passTimeText.trim()) {
      const targetDate = normalizeDateStr(draftItem.plannedDate) ?? normalizeDateStr(activeDate) ?? '2026-08-20';
      const iso = parseTimeInputToIso(passTimeText, targetDate);
      if (!iso) {
        setTimeError('Enter time as HH:MM AM/PM (e.g. 10:30 AM)');
        return;
      }
      plannedTime = iso;
    } else if (!passTimeText.trim()) {
      plannedTime = null;
    }

    const normDate = normalizeDateStr(draftItem.plannedDate);

    const body: PlannedItemEditInput = {
      ...(normDate ? { plannedDate: normDate } : {}),
      ...(plannedTime !== undefined ? { plannedTime: plannedTime ?? null } : {}),
      isFixed: draftItem.isFixed ?? false,
      isLightningLane: draftItem.isLightningLane ?? false,
      useSingleRider: draftItem.useSingleRider ?? false,
      priority: draftItem.priority ?? 2,
      itemType: draftItem.itemType ?? 'experience',
      ...(draftItem.durationMinutes ? { durationMinutes: draftItem.durationMinutes } : {}),
    };

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
              onPress={() => setShowAddModal(true)}
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
                    const expInfo = catalogMap.get(item.experienceId);
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
                                    Park Hop to {item.park} (Open til {getParkHoursDetails(item.park ?? '').openTimeText.split(' - ')[1] ?? '9:00 PM'})
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
                              <Text style={styles.mockupCardTitle}>{item.experienceName}</Text>

                              {/* Badges Row */}
                              <View style={styles.mockupBadgeRow}>
                                {predictedWaitMinutes != null && (
                                  <View style={styles.waitPillGray}>
                                    <Text style={styles.waitPillText}>Wait: {predictedWaitMinutes} min</Text>
                                  </View>
                                )}
                                <View style={styles.durationPillGray}>
                                  <Text style={styles.durationPillText}>🎢 {item.durationMinutes || 15}m duration</Text>
                                </View>
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
                    <Text style={styles.itemName}>{item.experienceName}</Text>
                    <View style={styles.itemProps}>
                      {item.isFixed && <Badge label="Fixed" color={theme.color.primary} />}
                      {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                      {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
                      {item.itemType === 'break' && <Badge label="Dining / Break" color={theme.color.success} />}
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
                    <Text style={styles.itemName}>{item.experienceName}</Text>
                    <View style={styles.itemProps}>
                      {item.isFixed && <Badge label="Fixed" color={theme.color.primary} />}
                      {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                      {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
                      {item.itemType === 'break' && <Badge label="Dining / Break" color={theme.color.success} />}
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
                  <Text style={styles.itemName}>{item.experienceName}</Text>
                  <View style={styles.itemProps}>
                    {item.isFixed && <Badge label="Fixed" color={theme.color.primary} />}
                    {item.isLightningLane && <Badge label="⚡ LL" color={theme.color.accent} />}
                    {item.useSingleRider && <Badge label="👤 Single Rider" color={theme.color.primaryLight} />}
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

          <Modal visible={showAddModal} animationType="slide" onRequestClose={() => setShowAddModal(false)}>
            <ScreenContainer>
              <GradientHeader
                title={`Add to ${formatDatePill(activeDate)}`}
                icon="search"
                compact
                onBack={() => setShowAddModal(false)}
              />
              <View style={styles.modalBody}>
                <ExperiencePicker
                  enabled={showAddModal}
                  onSelect={handleSelectExperience}
                  pendingId={addMutation.isPending ? addMutation.variables?.experienceId : null}
                  busy={addMutation.isPending}
                  testIDPrefix="schedule-picker"
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
                    <Text style={styles.modalTitle}>Options: {draftItem.experienceName}</Text>

                    <Text style={styles.label}>Queue & Pass Options</Text>
                    <View style={styles.modalActions}>
                      <SecondaryButton
                        label={draftItem.isLightningLane ? '⚡ Lightning Lane Pass: Active' : '⚡ Add Lightning Lane Pass'}
                        onPress={() =>
                          setDraftItem((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  isLightningLane: !prev.isLightningLane,
                                  isFixed: !prev.isLightningLane ? true : prev.isFixed,
                                }
                              : null,
                          )
                        }
                      />
                      <SecondaryButton
                        label={draftItem.isFixed ? '🔒 Fixed Time Lock: Active' : '🔒 Set Fixed Reservation Time'}
                        onPress={() => setDraftItem((prev) => (prev ? { ...prev, isFixed: !prev.isFixed } : null))}
                      />
                      <SecondaryButton
                        label={draftItem.useSingleRider ? '👤 Single Rider Line: Active' : '👤 Single Rider Line: Off'}
                        onPress={() => setDraftItem((prev) => (prev ? { ...prev, useSingleRider: !prev.useSingleRider } : null))}
                      />
                    </View>

                    {(draftItem.isLightningLane || draftItem.isFixed) && (
                      <View style={styles.timeSection}>
                        <Text style={styles.label}>
                          {draftItem.isLightningLane ? '⚡ Lightning Lane Window Start Time' : '🔒 Reservation Time'}
                        </Text>

                        {(() => {
                          const { hour, minute, ampm } = parseTimeToWheelState(passTimeText);

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

                              <View style={styles.wheelGrid}>
                                <View style={styles.wheelColumn}>
                                  <Text style={styles.wheelColHeader}>Hour</Text>
                                  <ScrollView style={styles.wheelScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                                    {HOURS_12.map((h) => {
                                      const isSel = hour === h;
                                      return (
                                        <Pressable
                                          key={h}
                                          style={[styles.wheelItem, isSel && styles.wheelItemActive]}
                                          onPress={() => {
                                            setPassTimeText(`${h}:${minute} ${ampm}`);
                                            setTimeError(null);
                                          }}
                                        >
                                          <Text style={[styles.wheelItemText, isSel && styles.wheelItemTextActive]}>
                                            {h}
                                          </Text>
                                        </Pressable>
                                      );
                                    })}
                                  </ScrollView>
                                </View>

                                <View style={styles.wheelColumn}>
                                  <Text style={styles.wheelColHeader}>Min</Text>
                                  <ScrollView style={styles.wheelScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                                    {MINUTES_15.map((m) => {
                                      const isSel = minute === m;
                                      return (
                                        <Pressable
                                          key={m}
                                          style={[styles.wheelItem, isSel && styles.wheelItemActive]}
                                          onPress={() => {
                                            setPassTimeText(`${hour}:${m} ${ampm}`);
                                            setTimeError(null);
                                          }}
                                        >
                                          <Text style={[styles.wheelItemText, isSel && styles.wheelItemTextActive]}>
                                            :{m}
                                          </Text>
                                        </Pressable>
                                      );
                                    })}
                                  </ScrollView>
                                </View>

                                <View style={styles.wheelColumn}>
                                  <Text style={styles.wheelColHeader}>AM / PM</Text>
                                  <View style={styles.ampmBox}>
                                    {AMPM_LIST.map((ap) => {
                                      const isSel = ampm === ap;
                                      return (
                                        <Pressable
                                          key={ap}
                                          style={[styles.ampmBtn, isSel && styles.ampmBtnActive]}
                                          onPress={() => {
                                            setPassTimeText(`${hour}:${minute} ${ap}`);
                                            setTimeError(null);
                                          }}
                                        >
                                          <Text style={[styles.ampmText, isSel && styles.ampmTextActive]}>
                                            {ap}
                                          </Text>
                                        </Pressable>
                                      );
                                    })}
                                  </View>
                                </View>
                              </View>
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
                              <View style={styles.llWindowBox}>
                                <Text style={styles.llWindowText}>Return Window: {info.windowStr}</Text>
                                <Text style={styles.llGraceText}>Valid Entry: {info.graceStr} (5m early / 15m late grace)</Text>
                              </View>
                            );
                          })()
                        )}
                      </View>
                    )}

                    <Text style={styles.label}>Type & Category</Text>
                    <View style={styles.chipRow}>
                      <Pressable
                        style={[styles.optionChip, draftItem.itemType !== 'break' && styles.optionChipActive]}
                        onPress={() => setDraftItem((prev) => (prev ? { ...prev, itemType: 'experience' } : null))}
                      >
                        <Text style={[styles.optionChipText, draftItem.itemType !== 'break' && styles.optionChipTextActive]}>
                          Attraction
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.optionChip, draftItem.itemType === 'break' && styles.optionChipActive]}
                        onPress={() => setDraftItem((prev) => (prev ? { ...prev, itemType: 'break' } : null))}
                      >
                        <Text style={[styles.optionChipText, draftItem.itemType === 'break' && styles.optionChipTextActive]}>
                          🍽️ Dining / Break
                        </Text>
                      </Pressable>
                    </View>

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
});
