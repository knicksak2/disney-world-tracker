// Feature: trips, Task 17.7 — Active_Trip_Shortcut
//
// Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
//
// A reusable control surfaced on App surfaces OUTSIDE the Trips tab (wired into
// the Home screen; droppable onto any other non-Trips surface) that gives the
// User one-tap access to the Trip they are currently on so in-park logging is
// immediate.
//
// Behavior:
//   - Reads `GET /me/trips` via TanStack Query, sharing the exact query key the
//     `Trips_List_Screen` uses (`tripsListKeys.list()`), so the two surfaces
//     share one cache entry. The endpoint returns the caller's Trips grouped by
//     derived Trip_Status; the shortcut filters to the `active` group.
//   - WHILE the User is a Trip_Member of >= 1 `active` Trip, the shortcut is
//     shown (R19.1). WHILE there are none, it renders nothing (R19.3). It also
//     renders nothing while the first load is in flight or the read errors, so
//     it never claims an active Trip it has not confirmed.
//   - Activating with exactly one active Trip opens that Trip's Trip_Detail_View
//     directly (R19.2). With more than one it opens a chooser listing the active
//     Trips; selecting one opens that Trip (R19.4, R19.5).
//   - On activation the shortcut re-reads `/me/trips` and re-derives the active
//     set before navigating: if the chosen Trip is no longer `active` or the
//     User is no longer a Trip_Member, it falls back to the Trips_List_Screen
//     with a "no longer available" message instead of opening a stale Trip
//     (R19.6). The message is stashed in the shared Trips-list notice store and
//     rendered by the Trips_List_Screen.
//
// Navigation is issued through `navigationRef` helpers so the component is
// surface-agnostic — it needs no navigation prop and behaves identically
// wherever it is placed.

import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';

import type { Park, PlannedItemDTO, TripDTO, TripStatus } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import {
  navigateToTripDetail,
  navigateToTripsList,
  navigateToTripSchedule,
} from '../navigation/navigationRef';
import { setTripsListNotice } from '../navigation/tripsListNotice';
import { tripsListKeys } from '../screens/trips/TripsListScreen';
import { tripPlannedListKeys } from '../screens/trips/TripPlannedListScreen';
import { getTodayWDW } from '../screens/trips/TripScheduleScreen';
import { formatParkTime } from '../screens/catalog/live/parkTime';
import { deriveTodaysPark } from '../screens/home/deriveTodaysPark';
import { theme } from '../theme/theme';
import { Card, PrimaryButton } from '../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One status group as returned by `GET /me/trips` — a `status` discriminator
 * plus the group's Trips in display order. Empty groups are omitted server
 * side, so any group present here has at least one Trip. Mirrors the shape the
 * `Trips_List_Screen` consumes.
 */
interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

/** Wire shape of `GET /me/trips`: the non-empty groups in presentation order. */
type TripsListResponse = readonly TripStatusGroup[];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Copy shown on the Trips_List_Screen when the target Trip is stale (R19.6). */
const STALE_NOTICE = 'That active trip is no longer available.';

const PARK_EMOJIS: Record<string, string> = {
  'Magic Kingdom': '🏰',
  EPCOT: '🌐',
  'Hollywood Studios': '🎬',
  'Animal Kingdom': '🦁',
};

const PARK_GRADIENTS: Record<string, readonly [string, string]> = {
  'Magic Kingdom': ['#7e57c2', '#5b2a86'],
  EPCOT: ['#3b82f6', '#1d4ed8'],
  'Hollywood Studios': ['#f43f5e', '#be123c'],
  'Animal Kingdom': ['#22c55e', '#15803d'],
};

function formatDisplayTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('T') || raw.includes('Z')) {
    const formatted = formatParkTime(raw);
    return formatted !== '—' ? formatted : raw;
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) {
    const h = parseInt(match[1]!, 10);
    const m = match[2]!;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${m} ${period}`;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the caller's `active` Trips from a `/me/trips` response. The active
 * group is either present (with >= 1 Trip) or omitted entirely, so a missing
 * group collapses to an empty list.
 */
function activeTripsOf(data: TripsListResponse | undefined): readonly TripDTO[] {
  if (data === undefined) {
    return [];
  }
  const group = data.find((g) => g.status === 'active');
  return group?.trips ?? [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The Active_Trip_Shortcut. Renders the active in-park vacation hero card matching
 * the redesign mockup. Shows nothing unless the User is a Member of >= 1 active Trip.
 */
export default function ActiveTripShortcut(): JSX.Element | null {
  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
  });

  const { refetch } = tripsQuery;
  const [chooserVisible, setChooserVisible] = useState(false);
  const activeTrips = activeTripsOf(tripsQuery.data);
  const single = activeTrips[0];

  // Fetch planned items for the single active trip to display next attraction & dining
  const plannedItemsQuery = useQuery<readonly PlannedItemDTO[]>({
    queryKey: tripPlannedListKeys.items(single?.id ?? ''),
    queryFn: () =>
      apiRequest<readonly PlannedItemDTO[]>(
        'GET',
        `/trips/${encodeURIComponent(single?.id ?? '')}/planned-items`,
      ),
    enabled: Boolean(single?.id),
    staleTime: 60 * 1000,
  });

  const plannedItems = plannedItemsQuery.data ?? [];
  const todayStr = getTodayWDW();

  // Derive day numbers (e.g. Day 1 of 11) using calendar dates
  const { currentDay, totalDays } = useMemo(() => {
    if (!single?.startDate || !single?.endDate) {
      return { currentDay: 1, totalDays: 1 };
    }
    const [sY, sM, sD] = single.startDate.split('-').map(Number);
    const [tY, tM, tD] = todayStr.split('-').map(Number);
    const [eY, eM, eD] = single.endDate.split('-').map(Number);
    if (!sY || !sM || !sD || !tY || !tM || !tD || !eY || !eM || !eD) {
      return { currentDay: 1, totalDays: 1 };
    }
    const startDate = new Date(sY, sM - 1, sD);
    const todayDate = new Date(tY, tM - 1, tD);
    const endDate = new Date(eY, eM - 1, eD);
    const total = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
    const diffDays = Math.floor((todayDate.getTime() - startDate.getTime()) / 86400000);
    const current = Math.min(total, Math.max(1, diffDays + 1));
    return { currentDay: current, totalDays: total };
  }, [single?.startDate, single?.endDate, todayStr]);

  const todayPark = useMemo<Park>(
    () =>
      deriveTodaysPark({
        activeTrip: single,
        plannedItems,
        todayStr,
      }),
    [single, plannedItems, todayStr],
  );

  // Derive next ride/attraction and dining reservation strictly from today's items
  const { nextItem, diningItem } = useMemo(() => {
    const todaysItems = plannedItems.filter((i) => i.plannedDate === todayStr);

    const isDining = (i: PlannedItemDTO) =>
      i.reservationKind === 'dining' || (i.mealPeriod !== null && i.itemType !== 'break');

    const rides = todaysItems.filter((i) => i.itemType !== 'break' && !isDining(i));
    const diningItems = todaysItems.filter(isDining);

    const parseTimeMs = (timeStr: string | null | undefined): number | null => {
      if (!timeStr) return null;
      if (timeStr.includes('T') || timeStr.includes('Z')) {
        const ms = new Date(timeStr).getTime();
        return isNaN(ms) ? null : ms;
      }
      const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
      if (match) {
        const [y, m, d] = todayStr.split('-').map(Number);
        if (y && m && d) {
          const hours = parseInt(match[1]!, 10);
          const minutes = parseInt(match[2]!, 10);
          return new Date(y, m - 1, d, hours, minutes).getTime();
        }
      }
      return null;
    };

    const now = Date.now();
    const upcomingRides = rides.filter((i) => {
      const ms = parseTimeMs(i.plannedTime);
      return ms === null || ms >= now - 30 * 60 * 1000;
    });
    const next = upcomingRides[0] ?? rides[0] ?? null;

    const upcomingDining = diningItems.filter((i) => {
      const ms = parseTimeMs(i.plannedTime);
      return ms === null || ms >= now - 60 * 60 * 1000;
    });
    const dining = upcomingDining[0] ?? diningItems[0] ?? null;

    return { nextItem: next, diningItem: dining };
  }, [plannedItems, todayStr]);

  const openTrip = useCallback(
    async (tripId: string) => {
      let latest = activeTripsOf(tripsQuery.data);
      try {
        const result = await refetch();
        if (result.data !== undefined) {
          latest = activeTripsOf(result.data);
        }
      } catch {
        // Fall back to last known active set
      }

      if (latest.some((trip) => trip.id === tripId)) {
        navigateToTripDetail({ tripId });
        return;
      }

      setTripsListNotice(STALE_NOTICE);
      navigateToTripsList();
    },
    [refetch, tripsQuery.data],
  );

  const handleActivate = useCallback(() => {
    const current = activeTripsOf(tripsQuery.data);
    if (current.length > 1) {
      setChooserVisible(true);
      return;
    }
    const singleTrip = current[0];
    if (singleTrip !== undefined) {
      void openTrip(singleTrip.id);
    }
  }, [openTrip, tripsQuery.data]);

  const handleSelect = useCallback(
    (tripId: string) => {
      setChooserVisible(false);
      void openTrip(tripId);
    },
    [openTrip],
  );

  if (activeTrips.length === 0) {
    return null;
  }

  const multiple = activeTrips.length > 1;

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.activeCard, pressed && styles.pressed]}
        onPress={handleActivate}
        testID="active-trip-shortcut"
        accessibilityRole="button"
        accessibilityLabel={
          multiple
            ? `You have ${activeTrips.length} active trips. Open your active trips.`
            : `Open your active trip, ${single?.name ?? ''}.`
        }
      >
        <LinearGradient
          colors={['#ffffff', '#f0fdf4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          {/* Top Row: Active tag + Today's Schedule button */}
          <View style={styles.topRow}>
            <View style={styles.tagLeft}>
              <View style={styles.pulseDot} />
              <Text style={styles.tagText}>
                {multiple
                  ? `ACTIVE VACATION • ${activeTrips.length} TRIPS NOW`
                  : `ACTIVE VACATION • DAY ${currentDay} OF ${totalDays}`}
              </Text>
            </View>
            <Pressable
              style={styles.scheduleBadge}
              onPress={(e) => {
                e.stopPropagation();
                if (single?.id) {
                  navigateToTripSchedule({ tripId: single.id });
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Open today's schedule"
              hitSlop={8}
            >
              <Text style={styles.scheduleBadgeText}>Today's Schedule ›</Text>
            </Pressable>
          </View>

          {/* Main Row: Park Emoji Squircle + Trip details */}
          <View style={styles.contentRow}>
            <LinearGradient
              colors={PARK_GRADIENTS[todayPark ?? 'Magic Kingdom'] ?? ['#7e57c2', '#5b2a86']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.parkIconTile}
            >
              <Text style={styles.parkEmoji}>{PARK_EMOJIS[todayPark ?? 'Magic Kingdom'] ?? '🏰'}</Text>
            </LinearGradient>

            <View style={styles.detailsCol}>
              <Text style={styles.tripTitle} numberOfLines={1}>
                {multiple
                  ? `${activeTrips.length} trips happening now`
                  : single?.name ? single.name : 'Disney Vacation'}
              </Text>

              <View style={styles.nextItemRow}>
                <Text style={styles.nextItemText} numberOfLines={1}>
                  {nextItem
                    ? `🚀 Next: ${nextItem.customTitle || nextItem.experienceName || 'Attraction'}`
                    : '🚀 Next: Tap to plan your day'}
                </Text>
                {nextItem?.plannedTime ? (
                  <View style={styles.timePill}>
                    <Text style={styles.timePillText}>
                      {formatDisplayTime(nextItem.plannedTime)}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.diningText} numberOfLines={1}>
                {diningItem
                  ? `🍽️ Dining: ${diningItem.customTitle || diningItem.experienceName || 'Reservation'}${
                      diningItem.plannedTime ? ` • ${formatDisplayTime(diningItem.plannedTime)}` : ''
                    }`
                  : '🍽️ Dining: Tap to add dining'}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </Pressable>

      <ActiveTripChooser
        visible={chooserVisible}
        trips={activeTrips}
        onSelect={handleSelect}
        onCancel={() => setChooserVisible(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Chooser (R19.4, R19.5)
// ---------------------------------------------------------------------------

interface ActiveTripChooserProps {
  readonly visible: boolean;
  readonly trips: readonly TripDTO[];
  readonly onSelect: (tripId: string) => void;
  readonly onCancel: () => void;
}

/**
 * Chooser presented when the User has more than one active Trip. Lists the
 * active Trips; selecting one hands its id back to open it (R19.5).
 */
function ActiveTripChooser({
  visible,
  trips,
  onSelect,
  onCancel,
}: ActiveTripChooserProps): JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="active-trip-chooser">
          <Text style={styles.modalTitle}>Your active trips</Text>
          <Text style={styles.modalBody}>
            Pick the trip you want to open.
          </Text>

          <View style={styles.chooserList}>
            {trips.map((trip) => (
              <Card
                key={trip.id}
                accentColor={theme.color.success}
                style={styles.chooserRow}
                onPress={() => onSelect(trip.id)}
                testID={`active-trip-chooser-${trip.id}`}
              >
                <View style={styles.chooserRowInner}>
                  <View style={styles.chooserRowText}>
                    <Text style={styles.chooserRowName} numberOfLines={1}>
                      {trip.name}
                    </Text>
                    <Text style={styles.chooserRowDates} numberOfLines={1}>
                      {formatDateRange(trip)}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={theme.color.textSecondary}
                  />
                </View>
              </Card>
            ))}
          </View>

          <View style={styles.modalActions}>
            <PrimaryButton
              label="Not now"
              onPress={onCancel}
              testID="active-trip-chooser-cancel"
              style={styles.flexBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a Trip's date range; collapses a single-day Trip to one date. */
function formatDateRange(trip: TripDTO): string {
  return trip.startDate === trip.endDate
    ? trip.startDate
    : `${trip.startDate} \u2013 ${trip.endDate}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  activeCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#86efac',
    marginHorizontal: theme.spacing.md,
    marginTop: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
    backgroundColor: '#ffffff',
  },
  cardGradient: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scheduleBadge: {
    backgroundColor: 'rgba(91, 42, 134, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scheduleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.color.primary,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  parkIconTile: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: theme.color.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  parkEmoji: {
    fontSize: 24,
  },
  detailsCol: {
    flex: 1,
    minWidth: 0,
  },
  tripTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  nextItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  nextItemText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#166534',
    flexShrink: 1,
  },
  timePill: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  timePillText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#15803d',
  },
  diningText: {
    fontSize: 10.5,
    color: theme.color.textSecondary,
    marginTop: 3,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  card: {
    marginHorizontal: theme.spacing.md,
    marginTop: 12,
    marginBottom: 12,
    padding: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    ...theme.typography.meta,
    color: theme.color.success,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  subtitle: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 400,
    gap: theme.spacing.sm,
    ...theme.shadow.floating,
  },
  modalTitle: {
    ...theme.typography.heading,
    color: theme.color.textPrimary,
  },
  modalBody: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  chooserList: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  chooserRow: {
    padding: theme.spacing.md,
  },
  chooserRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  chooserRowText: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  chooserRowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  chooserRowDates: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
