/**
 * Trip Booking Timeline Screen (Task 11.5).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 10.4
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  formatDateRange,
  formatMonthDay,
  type BookingSettingsUpdateInput,
  type BookingTimelineDTO,
  type BookingWindowDTO,
  type TripDTO,
  type TripMemberDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { setTripsListNotice } from '../../navigation/tripsListNotice';
import { Card, EmptyState, GradientHeader, PrimaryButton, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { themedSwitchProps } from '../../theme/switchColors';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { TIMELINE_PALETTE } from './TripBookingTimelineScreen.palette';
import {
  bookingKeys,
  fetchBookingTimeline,
  patchBookingSettings,
  putReminderMute,
  putWindowDone,
} from './bookingTimelineApi';
import {
  countdownLabel,
  donePresentation,
  formatDropMoment,
  sourceLabel,
  splitWindows,
  statusPresentation,
  type SettingsFormValues,
} from './bookingTimelineView';
import { BookingSettingsModal } from './BookingSettingsModal';
import { tripDetailKeys } from './tripDetailQueryKeys';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripBookingTimeline'>;

interface MeResponse {
  readonly user: { readonly id: string };
}

function formatStayTypeLabel(val: string): string {
  switch (val) {
    case 'resort':
      return 'Resort';
    case 'partner_hotel':
      return 'Partner hotel';
    case 'offsite':
      return 'Off-site';
    default:
      return val;
  }
}

function formatTimingLabel(val: string): string {
  switch (val) {
    case 'seven_day':
      return '7 days before check-in';
    case 'three_day':
      return '3 days before (whole trip)';
    case 'three_day_daily':
      return '3 days before (each day)';
    default:
      return val;
  }
}

export default function TripBookingTimelineScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const palette = usePalette(TIMELINE_PALETTE);
  const queryClient = useQueryClient();
  const { tripId } = route.params;

  const [isPastExpanded, setIsPastExpanded] = useState(false);
  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [pendingDoneKeys, setPendingDoneKeys] = useState<Set<string>>(new Set());

  // Inline error banners
  const [doneError, setDoneError] = useState<string | null>(null);
  const [muteError, setMuteError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // Queries
  const timelineQuery = useQuery<BookingTimelineDTO, ApiError>({
    queryKey: bookingKeys.timeline(tripId),
    queryFn: () => fetchBookingTimeline(tripId),
    staleTime: 30 * 1000,
  });

  const tripQuery = useQuery<TripDTO, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
    staleTime: 30 * 1000,
    retry: false,
  });

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    staleTime: 30 * 1000,
    retry: false,
  });

  // Role resolution (matching TripDetailScreen pattern)
  const callerId = meQuery.data?.user?.id;
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const isOrganizer =
    callerId !== undefined &&
    members.some((m) => m.userId === callerId && m.role === 'organizer');

  // Unavailable Trip redirect (R10.4)
  useEffect(() => {
    if (timelineQuery.isError) {
      const err = timelineQuery.error as unknown as { code?: string };
      const code = err?.code;
      if (code === 'trip_forbidden' || code === 'trip_not_found') {
        setTripsListNotice('That booking timeline is no longer available.');
        navigation.navigate('TripsList');
      }
    }
  }, [timelineQuery.isError, timelineQuery.error, navigation]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('TripsList');
    }
  }, [navigation]);

  // Window Done toggle mutation
  const handleToggleDone = useCallback(
    async (w: BookingWindowDTO) => {
      if (pendingDoneKeys.has(w.windowKey)) return;
      setDoneError(null);
      setPendingDoneKeys((prev) => new Set(prev).add(w.windowKey));

      const nextDone = !w.done;
      try {
        const updated = await putWindowDone(tripId, w.kind, w.dropOn, nextDone);
        queryClient.setQueryData<BookingTimelineDTO>(bookingKeys.timeline(tripId), (old) => {
          if (!old) return old;
          return {
            ...old,
            windows: old.windows.map((win) => (win.windowKey === updated.windowKey ? updated : win)),
          };
        });
      } catch {
        setDoneError("Couldn't update booking status");
      } finally {
        setPendingDoneKeys((prev) => {
          const next = new Set(prev);
          next.delete(w.windowKey);
          return next;
        });
      }
    },
    [pendingDoneKeys, queryClient, tripId],
  );

  // Remind Me Switch mutation
  const timeline = timelineQuery.data;
  const isRemindMeOn = timeline ? !timeline.muted : true;

  const handleToggleRemindMe = useCallback(
    async (newOnValue: boolean) => {
      setMuteError(null);
      const newMuted = !newOnValue;

      // Optimistic update
      queryClient.setQueryData<BookingTimelineDTO>(bookingKeys.timeline(tripId), (old) => {
        if (!old) return old;
        return { ...old, muted: newMuted };
      });

      try {
        const res = await putReminderMute(tripId, newMuted);
        queryClient.setQueryData<BookingTimelineDTO>(bookingKeys.timeline(tripId), (old) => {
          if (!old) return old;
          return { ...old, muted: res.muted };
        });
      } catch {
        // Rollback
        queryClient.setQueryData<BookingTimelineDTO>(bookingKeys.timeline(tripId), (old) => {
          if (!old) return old;
          return { ...old, muted: !newMuted };
        });
        setMuteError("Couldn't update reminders");
      }
    },
    [queryClient, tripId],
  );

  // Booking Settings confirm handler
  const handleConfirmSettings = useCallback(
    async (changes: BookingSettingsUpdateInput) => {
      setSettingsError(null);
      try {
        await patchBookingSettings(tripId, changes);
        setIsSettingsModalVisible(false);
        void queryClient.invalidateQueries({ queryKey: bookingKeys.timeline(tripId) });
      } catch {
        setSettingsError("Couldn't save booking settings");
      }
    },
    [queryClient, tripId],
  );

  // Split windows
  const { active, past } = useMemo(() => {
    if (!timeline) return { active: [], past: [] };
    return splitWindows(timeline.windows);
  }, [timeline]);

  // Loading state
  if (timelineQuery.isLoading && timelineQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Booking timeline" icon="calendar-number-outline" compact onBack={handleBack} />
        <View style={styles.center} testID="booking-timeline-loading">
          <ActivityIndicator color={t.color.primaryFg} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  // Error state (non-redirect errors)
  if (timelineQuery.isError && timelineQuery.data === undefined) {
    const err = timelineQuery.error as unknown as { code?: string };
    if (err?.code !== 'trip_forbidden' && err?.code !== 'trip_not_found') {
      return (
        <ScreenContainer>
          <GradientHeader title="Booking timeline" icon="calendar-number-outline" compact onBack={handleBack} />
          <View style={styles.center} testID="booking-timeline-error">
            <EmptyState
              icon="cloud-offline-outline"
              title="We couldn't load the timeline"
              body="Please check your connection and try again."
            />
            <PrimaryButton
              label="Retry"
              icon="refresh-outline"
              onPress={() => {
                void timelineQuery.refetch();
              }}
              testID="booking-timeline-retry"
              style={styles.retryBtn}
            />
          </View>
        </ScreenContainer>
      );
    }
  }

  if (!timeline) {
    return (
      <ScreenContainer>
        <GradientHeader title="Booking timeline" icon="calendar-number-outline" compact onBack={handleBack} />
        <View style={styles.center} testID="booking-timeline-loading">
          <ActivityIndicator color={t.color.primaryFg} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const tripStart = tripQuery.data?.startDate ?? timeline.arrivalDate.value;
  const initialModalSettings: SettingsFormValues = {
    stayType: timeline.stayType.source === 'override' ? timeline.stayType.value : null,
    lightningLaneTiming:
      timeline.lightningLaneTiming.source === 'override' ? timeline.lightningLaneTiming.value : null,
    checkInOverride: timeline.arrivalDate.source === 'override' ? timeline.arrivalDate.value : null,
  };

  return (
    <ScreenContainer>
      <GradientHeader title="Booking timeline" icon="calendar-number-outline" compact onBack={handleBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} testID="booking-timeline-scroll">
        {/* Error Banners */}
        {doneError !== null && (
          <View style={styles.errorBanner} testID="booking-done-error">
            <Ionicons name="alert-circle-outline" size={16} color={t.color.danger} />
            <Text style={styles.errorBannerText}>{doneError}</Text>
          </View>
        )}
        {muteError !== null && (
          <View style={styles.errorBanner} testID="booking-mute-error">
            <Ionicons name="alert-circle-outline" size={16} color={t.color.danger} />
            <Text style={styles.errorBannerText}>{muteError}</Text>
          </View>
        )}
        {settingsError !== null && (
          <View style={styles.errorBanner} testID="booking-settings-error">
            <Ionicons name="alert-circle-outline" size={16} color={t.color.danger} />
            <Text style={styles.errorBannerText}>{settingsError}</Text>
          </View>
        )}

        {/* Settings Summary Card */}
        <Card style={styles.summaryCard} testID="booking-settings-summary-card">
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>Booking Settings</Text>
            {isOrganizer && (
              <Pressable
                onPress={() => setIsSettingsModalVisible(true)}
                style={styles.editButton}
                accessibilityRole="button"
                accessibilityLabel="Edit booking settings"
                testID="booking-settings-edit"
              >
                <Ionicons name="create-outline" size={16} color={t.color.primaryFg} />
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Stay type</Text>
            <View style={styles.summaryValueBlock}>
              <Text style={styles.summaryValue}>{formatStayTypeLabel(timeline.stayType.value)}</Text>
              <Text style={styles.summarySource}>{sourceLabel(timeline.stayType.source)}</Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Lightning Lane</Text>
            <View style={styles.summaryValueBlock}>
              <Text style={styles.summaryValue}>
                {formatTimingLabel(timeline.lightningLaneTiming.value)}
              </Text>
              <Text style={styles.summarySource}>
                {sourceLabel(timeline.lightningLaneTiming.source)}
              </Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Arrival date</Text>
            <View style={styles.summaryValueBlock}>
              <Text style={styles.summaryValue}>{formatMonthDay(timeline.arrivalDate.value)}</Text>
              <Text style={styles.summarySource}>{sourceLabel(timeline.arrivalDate.source)}</Text>
            </View>
          </View>
        </Card>

        {/* Remind Me Toggle */}
        <Card style={styles.remindMeCard} testID="booking-remind-me-card">
          <View style={styles.remindMeRow}>
            <View style={styles.remindMeTextGroup}>
              <View style={styles.remindMeTitleRow}>
                <Ionicons name="notifications-outline" size={18} color={t.color.primaryFg} />
                <Text style={styles.remindMeTitle}>Remind me</Text>
              </View>
              <Text style={styles.remindMeSubtitle}>
                Get push notifications before booking windows open.
              </Text>
            </View>
            <Switch
              {...themedSwitchProps(t, isRemindMeOn)}
              key={t.scheme}
              value={isRemindMeOn}
              onValueChange={handleToggleRemindMe}
              accessibilityLabel="Remind me"
              accessibilityRole="switch"
              testID="booking-remind-me-switch"
            />
          </View>
        </Card>

        {/* Windows or Empty State */}
        {timeline.windows.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No booking windows"
            body="No booking windows were found for this trip."
            testID="booking-timeline-empty"
          />
        ) : (
          <>
            {/* Active Windows List */}
            <View style={styles.windowsSection}>
              {active.map((w) => (
                <BookingWindowRow
                  key={w.windowKey}
                  window={w}
                  isPending={pendingDoneKeys.has(w.windowKey)}
                  onToggleDone={handleToggleDone}
                  palette={palette}
                />
              ))}
            </View>

            {/* Past Windows Collapsible */}
            {past.length > 0 && (
              <View style={styles.pastSection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isPastExpanded }}
                  accessibilityLabel={`Past windows, ${past.length} windows`}
                  onPress={() => setIsPastExpanded((v) => !v)}
                  style={styles.pastHeader}
                  testID="booking-past-windows-header"
                >
                  <Text style={styles.pastHeaderText}>Past windows ({past.length})</Text>
                  <Ionicons
                    name={isPastExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={t.color.textSecondary}
                  />
                </Pressable>

                {isPastExpanded && (
                  <View style={styles.pastWindowsList}>
                    {past.map((w) => (
                      <BookingWindowRow
                        key={w.windowKey}
                        window={w}
                        isPending={pendingDoneKeys.has(w.windowKey)}
                        onToggleDone={handleToggleDone}
                        palette={palette}
                      />
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}

        {/* Rules note */}
        <Text style={styles.rulesNote}>
          Dates follow Disney's published booking rules (v{timeline.rulesVersion}) — confirm in My Disney Experience.
        </Text>
      </ScrollView>

      {/* Organizer Settings Modal */}
      {isOrganizer && (
        <BookingSettingsModal
          visible={isSettingsModalVisible}
          tripStart={tripStart}
          initialSettings={initialModalSettings}
          onConfirm={handleConfirmSettings}
          onCancel={() => setIsSettingsModalVisible(false)}
        />
      )}
    </ScreenContainer>
  );
}

interface WindowRowProps {
  readonly window: BookingWindowDTO;
  readonly isPending: boolean;
  readonly onToggleDone: (w: BookingWindowDTO) => void;
  readonly palette: (typeof TIMELINE_PALETTE)['light'];
}

function BookingWindowRow({
  window: w,
  isPending,
  onToggleDone,
  palette,
}: WindowRowProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  const isDining = w.kind === 'dining';
  const kindLabel = isDining ? 'Dining' : 'Lightning Lane';
  const kindIcon = isDining ? 'restaurant-outline' : 'flash-outline';

  const firstCovered = w.coveredDates[0] ?? '';
  const lastCovered = w.coveredDates[w.coveredDates.length - 1] ?? '';
  const dateRangeText = formatDateRange(firstCovered, lastCovered);

  const countdown = countdownLabel(w);
  const statusPres = statusPresentation(w.status);
  const donePres = donePresentation(w.done);

  const doneLabel = `${kindLabel} window, ${dateRangeText}: ${w.done ? 'Done' : 'Not done'}`;

  let statusBg = palette.upcomingBadgeBg;
  let statusFg = palette.upcomingBadgeFg;
  if (w.status === 'open') {
    statusBg = palette.openBadgeBg;
    statusFg = palette.openBadgeFg;
  } else if (w.status === 'past') {
    statusBg = palette.pastBadgeBg;
    statusFg = palette.pastBadgeFg;
  }

  return (
    <Card style={styles.windowCard} testID={`booking-window-${w.windowKey}`}>
      <View style={styles.windowHeader}>
        <View style={styles.kindBadge}>
          <Ionicons name={kindIcon} size={16} color={t.color.primaryFg} />
          <Text style={styles.kindLabel}>{kindLabel}</Text>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
          <Ionicons name={statusPres.icon} size={12} color={statusFg} />
          <Text style={[styles.statusLabel, { color: statusFg }]}>{statusPres.label}</Text>
        </View>
      </View>

      <Text style={styles.dropMomentText}>{formatDropMoment(w.dropAt)}</Text>
      <Text style={styles.dateRangeText}>Covers: {dateRangeText}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.bookedCountText}>{w.bookedCount} booked</Text>
        {countdown !== null && <Text style={styles.countdownText}>{countdown}</Text>}
      </View>

      <View style={styles.footerRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: w.done, disabled: isPending }}
          accessibilityLabel={doneLabel}
          onPress={() => onToggleDone(w)}
          disabled={isPending}
          style={[styles.doneButton, w.done && { backgroundColor: palette.doneBg }]}
          testID={`booking-window-done-${w.windowKey}`}
        >
          <Ionicons
            name={donePres.icon}
            size={18}
            color={w.done ? palette.doneFg : t.color.textSecondary}
          />
          <Text style={[styles.doneButtonText, w.done && { color: palette.doneFg }]}>
            {donePres.label}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.lg,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing.xxl,
  },
  retryBtn: {
    marginTop: t.spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: t.spacing.sm,
    backgroundColor: t.color.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: t.color.danger,
    borderRadius: t.radius.sm,
    marginBottom: t.spacing.sm,
    gap: t.spacing.xs,
  },
  errorBannerText: {
    ...t.typography.meta,
    color: t.color.danger,
    flex: 1,
  },
  summaryCard: {
    padding: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: t.spacing.sm,
  },
  summaryTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: t.radius.sm,
  },
  editButtonText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  summaryLabel: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  summaryValueBlock: {
    alignItems: 'flex-end',
  },
  summaryValue: {
    ...t.typography.body,
    color: t.color.textPrimary,
    fontWeight: '500',
  },
  summarySource: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontSize: 11,
  },
  remindMeCard: {
    padding: t.spacing.md,
    marginBottom: t.spacing.md,
  },
  remindMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  remindMeTextGroup: {
    flex: 1,
    marginRight: t.spacing.sm,
  },
  remindMeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    marginBottom: 2,
  },
  remindMeTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  remindMeSubtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  windowsSection: {
    gap: t.spacing.sm,
  },
  windowCard: {
    padding: t.spacing.md,
    marginBottom: t.spacing.sm,
  },
  windowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: t.spacing.xs,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kindLabel: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.pill,
  },
  statusLabel: {
    ...t.typography.meta,
    fontWeight: '600',
    fontSize: 11,
  },
  dropMomentText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginBottom: 2,
  },
  dateRangeText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: t.spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: t.spacing.sm,
  },
  bookedCountText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '500',
  },
  countdownText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    paddingTop: t.spacing.sm,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  doneButtonText: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    fontWeight: '500',
  },
  pastSection: {
    marginTop: t.spacing.sm,
  },
  pastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: t.spacing.md,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  pastHeaderText: {
    ...t.typography.heading,
    color: t.color.textSecondary,
  },
  pastWindowsList: {
    marginTop: t.spacing.sm,
    gap: t.spacing.sm,
  },
  rulesNote: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    textAlign: 'center',
    marginTop: t.spacing.md,
    lineHeight: 18,
  },
}));
