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

import React, { useCallback, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import type { TripDTO, TripStatus } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import {
  navigateToTripDetail,
  navigateToTripsList,
} from '../navigation/navigationRef';
import { setTripsListNotice } from '../navigation/tripsListNotice';
import { tripsListKeys } from '../screens/trips/TripsListScreen';
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
 * The Active_Trip_Shortcut. Renders nothing unless the User is a Trip_Member of
 * at least one `active` Trip (R19.1, R19.3). Safe to place on any surface
 * outside the Trips tab.
 */
export default function ActiveTripShortcut(): JSX.Element | null {
  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: tripsListKeys.list(),
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
  });

  const { refetch } = tripsQuery;

  const [chooserVisible, setChooserVisible] = useState(false);

  const activeTrips = activeTripsOf(tripsQuery.data);

  /**
   * Resolve the freshest active-Trip set, open the target Trip when it is still
   * active and the User is still a Member, or fall back to the Trips list with
   * a "no longer available" message when it is stale (R19.6). Re-reading before
   * navigating closes the window between the shortcut rendering and the User
   * tapping, during which a Trip may tick to `past` or membership may end.
   */
  const openTrip = useCallback(
    async (tripId: string) => {
      let latest = activeTripsOf(tripsQuery.data);
      try {
        const result = await refetch();
        if (result.data !== undefined) {
          latest = activeTripsOf(result.data);
        }
      } catch {
        // A failed re-read leaves `latest` as the last known active set; we
        // still validate against it below rather than opening blindly.
      }

      if (latest.some((trip) => trip.id === tripId)) {
        navigateToTripDetail({ tripId });
        return;
      }

      // R19.6: the chosen Trip is no longer active or the User is no longer a
      // Member — surface the message on the Trips list and go there instead.
      setTripsListNotice(STALE_NOTICE);
      navigateToTripsList();
    },
    [refetch, tripsQuery.data],
  );

  const handleActivate = useCallback(() => {
    const current = activeTripsOf(tripsQuery.data);
    if (current.length > 1) {
      // R19.4: more than one active Trip — let the User pick.
      setChooserVisible(true);
      return;
    }
    const single = current[0];
    if (single !== undefined) {
      // R19.2: exactly one active Trip — open it directly.
      void openTrip(single.id);
    }
  }, [openTrip, tripsQuery.data]);

  const handleSelect = useCallback(
    (tripId: string) => {
      setChooserVisible(false);
      void openTrip(tripId);
    },
    [openTrip],
  );

  // R19.3 (and defensive on loading/error): show nothing unless we have
  // confirmed >= 1 active Trip.
  if (activeTrips.length === 0) {
    return null;
  }

  const multiple = activeTrips.length > 1;

  return (
    <>
      <Card
        accentColor={theme.color.success}
        style={styles.card}
        onPress={handleActivate}
        testID="active-trip-shortcut"
        accessibilityLabel={
          multiple
            ? `You have ${activeTrips.length} active trips. Open your active trips.`
            : `Open your active trip, ${activeTrips[0]?.name ?? ''}.`
        }
      >
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Ionicons name="navigate" size={20} color={theme.color.success} />
          </View>
          <View style={styles.text}>
            <Text style={styles.eyebrow}>Active trip</Text>
            <Text style={styles.title} numberOfLines={1}>
              {multiple
                ? `${activeTrips.length} trips happening now`
                : activeTrips[0]?.name}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {multiple ? 'Tap to choose one to open' : 'Tap to log your day'}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.color.textSecondary}
          />
        </View>
      </Card>

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
  card: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.lg,
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
