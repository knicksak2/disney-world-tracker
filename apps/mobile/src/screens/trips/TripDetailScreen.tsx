// Feature: trips, Task 17.2 — Trip_Detail_View hub
//
// Validates: Requirements 18.1, 18.6
//
// Behavior summary:
//   - Reads `GET /trips/:id` via TanStack Query for the Trip header info
//     (name, description, date range, derived Trip_Status). Membership is
//     enforced server-side by the Trip_Member_Rule; a non-member / missing
//     Trip collapses to the same `trip_forbidden` response, which this screen
//     surfaces as an error with a Retry control (R15.2 non-disclosure).
//   - Presents the hub: a distinct navigation control for each of the Trip's
//     five sections — Planned_List, Shared_Log, Trip_Feed, Trip_Members, and
//     Trip_Summary (R18.1). Selecting a control opens the corresponding section
//     for this Trip by navigating to its route with the `tripId` (R18.6).
//
// The concrete section screens arrive in later 17.x tasks; this hub only wires
// the navigation controls to their routes (already declared on
// `TripsStackParamList`). Styling follows the shared "Magical / Whimsical"
// theme, mirroring `TripsListScreen`.

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { TripDTO, TripMemberDTO, TripStatus } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { useQuery } from '@tanstack/react-query';

/** Wire shape of `GET /me`: the caller's identity (to gate the Edit control). */
interface MeResponse {
  readonly user: { readonly id: string };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripDetail'>;

/** Wire shape of `GET /trips/:id`: the Trip header info for a Trip_Member. */
type TripDetailResponse = TripDTO;

/**
 * A single hub section control. `route` is the `TripsStackParamList` route the
 * control opens; every section route takes exactly `{ tripId }`, so a shared
 * navigate call reaches any of them (R18.6).
 */
interface HubSection {
  readonly key: string;
  readonly route:
    | 'TripPlannedList'
    | 'TripFeed'
    | 'TripMembers'
    | 'TripSummary';
  readonly title: string;
  readonly body: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for a single Trip's header info; keyed by Trip_Identifier. */
export const tripDetailKeys = {
  detail: (tripId: string) => ['trips', 'detail', tripId] as const,
};

/**
 * The hub sections, in presentation order (R18.1). Each maps to its section
 * route on the Trips stack and carries themed presentation metadata. The
 * Shared_Log and Trip_Feed are consolidated into the single Trip_Activity
 * section (R20.1).
 */
const HUB_SECTIONS: readonly HubSection[] = [
  {
    key: 'planned',
    route: 'TripPlannedList',
    title: 'Planned List',
    body: 'Experiences the group wants to do together.',
    icon: 'list-outline',
    color: theme.color.primary,
  },
  {
    key: 'activity',
    route: 'TripFeed',
    title: 'Trip Activity',
    body: 'Log completions and follow, react to, and comment on the group.',
    icon: 'chatbubbles-outline',
    color: theme.color.accent,
  },
  {
    key: 'members',
    route: 'TripMembers',
    title: 'Members',
    body: 'Who is on this Trip and their roles.',
    icon: 'people-outline',
    color: theme.color.primaryLight,
  },
  {
    key: 'summary',
    route: 'TripSummary',
    title: 'Summary',
    body: 'Group counts, top-rated moments, and contributions.',
    icon: 'stats-chart-outline',
    color: theme.color.textSecondary,
  },
];

/** Human labels + badge colors for each derived Trip_Status. */
const STATUS_META: Record<
  TripStatus,
  { readonly label: string; readonly color: string }
> = {
  active: { label: 'Active', color: theme.color.success },
  upcoming: { label: 'Upcoming', color: theme.color.primary },
  past: { label: 'Past', color: theme.color.textSecondary },
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function TripDetailScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const { tripId } = route.params;

  const tripQuery = useQuery<TripDetailResponse, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDetailResponse>('GET', `/trips/${tripId}`),
  });

  // Editing a Trip is Organizer-gated server-side (R3.8). To show the Edit
  // control only to Organizers, resolve the caller's role from `GET /me` +
  // the roster; a failed/unexpected read simply hides the control (the server
  // remains the authority). Reads are non-blocking and never gate the hub.
  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () =>
      apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    retry: false,
  });

  const callerId = meQuery.data?.user?.id;
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const isOrganizer =
    callerId !== undefined &&
    members.some(
      (member) => member.userId === callerId && member.role === 'organizer',
    );

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (tripQuery.isLoading && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trip"
          icon="map"
          compact
          onBack={() => {
            navigation.goBack();
          }}
        />
        <View style={styles.center} testID="trip-detail-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Error + Retry (membership failures collapse to trip_forbidden — R15.2)
  // -------------------------------------------------------------------------

  if (tripQuery.isError && tripQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trip"
          icon="map"
          compact
          onBack={() => {
            navigation.goBack();
          }}
        />
        <View style={styles.center} testID="trip-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load this trip"
            body={detailErrorMessage(tripQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tripQuery.refetch();
            }}
            testID="trip-detail-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const trip = tripQuery.data as TripDetailResponse;
  const statusMeta = STATUS_META[trip.status];

  return (
    <ScreenContainer>
      <GradientHeader
        title={trip.name}
        subtitle={formatDateRange(trip)}
        icon="map"
        compact
        onBack={() => {
          navigation.goBack();
        }}
        right={
          <View style={styles.headerRight}>
            <Badge label={statusMeta.label} color={statusMeta.color} />
            {isOrganizer ? (
              <Pressable
                onPress={() => {
                  navigation.navigate('TripEdit', { tripId });
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit trip"
                hitSlop={8}
                style={styles.editButton}
                testID="trip-detail-edit"
              >
                <Ionicons name="create-outline" size={22} color="#ffffff" />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.content} testID="trip-detail-hub">
        {trip.description.trim().length > 0 ? (
          <Text style={styles.description}>{trip.description}</Text>
        ) : null}

        {trip.resorts.length > 0 ? (
          <View style={styles.resorts} testID="trip-detail-resorts">
            <Text style={styles.resortsLabel}>Where you stayed</Text>
            <View style={styles.resortChips}>
              {trip.resorts.map((resort) => (
                <View
                  key={resort.id}
                  style={styles.resortChip}
                  testID={`trip-detail-resort-${resort.id}`}
                >
                  <Ionicons
                    name="bed-outline"
                    size={14}
                    color={theme.color.primary}
                  />
                  <Text style={styles.resortChipText}>{resort.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {HUB_SECTIONS.map((section) => (
          <SectionControl
            key={section.key}
            section={section}
            onPress={() => {
              navigation.navigate(section.route, { tripId });
            }}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SectionControl({
  section,
  onPress,
}: {
  readonly section: HubSection;
  readonly onPress: () => void;
}): JSX.Element {
  return (
    <Card
      accentColor={section.color}
      style={styles.section}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={section.title}
      testID={`trip-detail-section-${section.key}`}
    >
      <View style={styles.sectionRow}>
        <View
          style={[styles.sectionIcon, { backgroundColor: `${section.color}22` }]}
        >
          <Ionicons name={section.icon} size={22} color={section.color} />
        </View>
        <View style={styles.sectionText}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <Text style={styles.sectionBody}>{section.body}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={theme.color.textSecondary}
        />
      </View>
    </Card>
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

/** Map an API error to user-facing copy for the Trip detail hub (R15.2). */
function detailErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_forbidden':
    case 'trip_not_found':
      return 'This trip is no longer available.';
    default:
      return 'We had trouble reaching the server. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  retryBtn: {
    alignSelf: 'center',
    minWidth: 160,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  editButton: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  description: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  resorts: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  resortsLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resortChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  resortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: `${theme.color.primary}18`,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  resortChipText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
  },
  section: {
    marginBottom: 0,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionText: {
    flexShrink: 1,
    flexGrow: 1,
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  sectionBody: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
