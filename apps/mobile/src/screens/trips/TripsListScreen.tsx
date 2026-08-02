// Feature: trips, Task 17.1 — Trips_List_Screen
//
// Validates: Requirements 16.6, 16.7, 16.8, 16.9, 16.10
//
// Behavior summary:
//   - Reads `GET /me/trips` via TanStack Query. The endpoint returns the
//     caller's Trips already grouped by derived Trip_Status into the Active,
//     Upcoming, and Past groups in that fixed order, with empty groups omitted
//     server-side (see `services/trips/tripsList.ts::groupTripsByStatus`,
//     R16.2–R16.5). The screen renders exactly the groups it is handed, so the
//     grouping/ordering contract lives in one place.
//   - While the read is in flight and under 10 seconds have elapsed, a loading
//     indication is shown (R16.7).
//   - If the read fails OR does not complete within 10 seconds, an error
//     indication with a Retry control is shown and no partial/empty list is
//     presented as success (R16.8). The 10-second ceiling is enforced with a
//     per-attempt `AbortController`, and `retry: false` guarantees the error
//     surfaces on the first failure/timeout rather than after a silent retry
//     that could blow past the deadline.
//   - On a successful read of zero Trips, an empty-state indication with a
//     create control is shown (R16.9).
//   - A create control is always available (R16.9, R16.10): a header action on
//     the populated/empty list plus the empty-state button. It opens an inline
//     create modal (name + optional description + start/end dates) validated by
//     the shared `tripCreateSchema` and posts `POST /me/trips`; on success the
//     list is invalidated and the screen navigates straight into the new Trip's
//     Trip_Detail_View.
//   - Selecting a Trip navigates to the Trip_Detail_View for that Trip (R16.6).
//
// Styling follows the shared "Magical / Whimsical" theme (gradient hero header,
// section labels, Trip rows as `Card`s, themed buttons) — mirroring
// `FriendsListScreen` and the create modal in catalog `CompletionControls`.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  tripCreateSchema,
  TRIP_RESORT_LIMIT,
  type ResortDTO,
  type TripDTO,
  type TripIncomingInviteDTO,
  type TripStatus,
} from '@dwt/shared';

import { Ionicons } from '@expo/vector-icons';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { ResortPicker } from '../../components/ResortPicker';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import {
  clearTripsListNotice,
  useTripsListNotice,
} from '../../navigation/tripsListNotice';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<TripsStackParamList, 'TripsList'>;

/**
 * One status group as returned by `GET /me/trips`. Mirrors
 * `TripStatusGroup<TripDTO>` produced by the Trip_Service's
 * `groupTripsByStatus` — a `status` discriminator plus the group's Trips in
 * display order. The server omits empty groups, so any group present here has
 * at least one Trip (R16.2–R16.5).
 */
interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

/** Wire shape of `GET /me/trips`: the non-empty groups in presentation order. */
type TripsListResponse = readonly TripStatusGroup[];

/** Wire shape of `POST /me/trips`: the created Trip's identity (R1.9). */
interface TripCreatedResponse {
  readonly id: string;
}

/**
 * Discriminated row union for the unified `FlatList`. Encoding section headers
 * and Trip rows as one tagged array lets the screen scroll as a single list
 * while keeping `keyExtractor`/`renderItem` trivial.
 */
type Row =
  | { readonly kind: 'header'; readonly id: string; readonly label: string }
  | { readonly kind: 'trip'; readonly id: string; readonly trip: TripDTO };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Query key for the Trips list; invalidated after a create so it refreshes. */
export const tripsListKeys = {
  list: () => ['trips', 'list'] as const,
};

/**
 * Query key for the caller's pending Trip invitations (`GET /me/trip-invites`);
 * invalidated after accept/decline so the section refreshes, and after an
 * accept the Trips list itself is invalidated so the newly-joined Trip appears.
 */
export const tripInvitesKeys = {
  list: () => ['trips', 'invites'] as const,
};

/**
 * R16.7/R16.8 deadline: a retrieval that does not complete within 10 seconds is
 * treated as a failure. Enforced per attempt via `AbortController`.
 */
const TRIPS_LOAD_TIMEOUT_MS = 10_000;

/** Human labels + badge colors for each status group, in presentation order. */
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

export default function TripsListScreen({ navigation }: Props): JSX.Element {
  const queryClient = useQueryClient();

  // A "no longer available" notice queued by a fallback navigation — e.g. the
  // Active_Trip_Shortcut when its target Trip ticked out of `active` or the
  // User lost membership (R19.6). Shown as a dismissible banner and cleared
  // when the screen loses focus so it appears once and never lingers.
  const notice = useTripsListNotice();
  useFocusEffect(
    useCallback(() => () => {
      clearTripsListNotice();
    }, []),
  );

  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: tripsListKeys.list(),
    // A retrieval that fails or exceeds the 10s ceiling must surface as an
    // error rather than a partial/empty success (R16.8). We give each attempt
    // its own AbortController so the 10s ceiling maps to a rejected fetch, and
    // disable retries so the error shows on the first failure/timeout instead
    // of after a silent retry that could exceed the deadline.
    queryFn: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, TRIPS_LOAD_TIMEOUT_MS);
      try {
        return await apiRequest<TripsListResponse>(
          'GET',
          '/me/trips',
          undefined,
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    },
    retry: false,
  });

  const { refetch: refetchTrips } = tripsQuery;

  // Refetch on focus so a Trip created/joined elsewhere (including via a deep
  // link) appears without an app restart when this screen is already mounted.
  useFocusEffect(
    useCallback(() => {
      void refetchTrips();
    }, [refetchTrips]),
  );

  // Create modal state. The modal owns its own draft + inline error so the
  // list behind it is untouched while the user fills the form.
  const [createVisible, setCreateVisible] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftResortIds, setDraftResortIds] = useState<readonly string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetCreateForm = useCallback(() => {
    setDraftName('');
    setDraftDescription('');
    setDraftStart('');
    setDraftEnd('');
    setDraftResortIds([]);
    setCreateError(null);
  }, []);

  // Catalog Resort options for the "where you stayed" picker (R21.1). Read from
  // the same `GET /resorts` endpoint the catalog uses; the field is optional so
  // a failed/empty read simply hides the picker rather than blocking create.
  const resortsQuery = useQuery<readonly ResortDTO[], ApiError>({
    queryKey: ['resorts', 'list'],
    queryFn: async () => {
      const res = await apiRequest<{ resorts: readonly ResortDTO[] }>(
        'GET',
        '/resorts',
      );
      return res.resorts;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const toggleResort = useCallback((resortId: string) => {
    setDraftResortIds((current) => {
      if (current.includes(resortId)) {
        return current.filter((id) => id !== resortId);
      }
      // Respect the shared bound; ignore a toggle that would exceed it.
      if (current.length >= TRIP_RESORT_LIMIT) {
        return current;
      }
      return [...current, resortId];
    });
    if (createError !== null) setCreateError(null);
  }, [createError]);

  const openCreate = useCallback(() => {
    resetCreateForm();
    setCreateVisible(true);
  }, [resetCreateForm]);

  const createMutation = useMutation<TripCreatedResponse, ApiError, void>({
    mutationFn: async () => {
      // Validate client-side with the shared schema so the create control
      // enforces the same Trip_Name/description/date rules as the server.
      const parsed = tripCreateSchema.safeParse({
        name: draftName,
        ...(draftDescription.trim().length > 0
          ? { description: draftDescription }
          : {}),
        startDate: draftStart.trim(),
        endDate: draftEnd.trim(),
        ...(draftResortIds.length > 0 ? { resortIds: draftResortIds } : {}),
      });
      if (!parsed.success) {
        throw new ApiError({
          code: 'trip_validation_failed',
          message: firstIssueMessage(parsed.error),
          status: 400,
        });
      }
      return apiRequest<TripCreatedResponse>('POST', '/me/trips', parsed.data);
    },
    onSuccess: (created) => {
      setCreateVisible(false);
      resetCreateForm();
      void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
      // R16.6-style hand-off: drop the User straight into the new Trip's hub.
      navigation.navigate('TripDetail', { tripId: created.id });
    },
    onError: (err) => {
      setCreateError(tripsErrorMessage(err));
    },
  });

  const createBusy = createMutation.isPending;

  // -------------------------------------------------------------------------
  // Pending invitations (invitee-facing inbox)
  // -------------------------------------------------------------------------
  // A friend added to a Trip only becomes a Member after accepting; until then
  // the Trip does not appear in `GET /me/trips`. This section surfaces those
  // pending invites so the invited User can accept/decline in-app without
  // depending on the push-notification deep-link.
  const invitesQuery = useQuery<readonly TripIncomingInviteDTO[], ApiError>({
    queryKey: tripInvitesKeys.list(),
    queryFn: () =>
      apiRequest<readonly TripIncomingInviteDTO[]>('GET', '/me/trip-invites'),
    retry: false,
  });

  const { refetch: refetchInvites } = invitesQuery;

  // Refetch invitations on focus so an invite sent while this screen is mounted
  // appears without an app restart.
  useFocusEffect(
    useCallback(() => {
      void refetchInvites();
    }, [refetchInvites]),
  );

  // Track which invite is mid-action so only its row shows a busy state.
  const [pendingInviteId, setPendingInviteId] = useState<string | null>(null);

  const acceptInviteMutation = useMutation<{ tripId: string }, ApiError, string>(
    {
      mutationFn: (inviteId) =>
        apiRequest<{ tripId: string }>(
          'POST',
          `/me/trip-invites/${inviteId}/accept`,
        ),
      onMutate: (inviteId) => {
        setPendingInviteId(inviteId);
      },
      onSuccess: (result) => {
        void queryClient.invalidateQueries({
          queryKey: tripInvitesKeys.list(),
        });
        // The accepted Trip is now a membership — refresh the list so it shows.
        void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
        navigation.navigate('TripDetail', { tripId: result.tripId });
      },
      onSettled: () => {
        setPendingInviteId(null);
      },
    },
  );

  const declineInviteMutation = useMutation<void, ApiError, string>({
    mutationFn: (inviteId) =>
      apiRequest<void>('POST', `/me/trip-invites/${inviteId}/decline`),
    onMutate: (inviteId) => {
      setPendingInviteId(inviteId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tripInvitesKeys.list() });
    },
    onSettled: () => {
      setPendingInviteId(null);
    },
  });

  const invites = invitesQuery.data ?? [];
  const inviteActionBusy =
    acceptInviteMutation.isPending || declineInviteMutation.isPending;

  // -------------------------------------------------------------------------
  // Loading (R16.7)
  // -------------------------------------------------------------------------

  if (tripsQuery.isLoading && tripsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trips"
          subtitle="Plan and log your park days together."
          icon="map"
        />
        <View style={styles.center} testID="trips-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // -------------------------------------------------------------------------
  // Error + Retry (R16.8)
  // -------------------------------------------------------------------------

  if (tripsQuery.isError && tripsQuery.data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Trips"
          subtitle="Plan and log your park days together."
          icon="map"
        />
        <View style={styles.center} testID="trips-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load your trips"
            body={tripsErrorMessage(tripsQuery.error)}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void tripsQuery.refetch();
            }}
            testID="trips-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const groups = tripsQuery.data ?? [];
  const totalTrips = groups.reduce((sum, group) => sum + group.trips.length, 0);
  const rows = buildRows(groups);

  return (
    <ScreenContainer>
      <GradientHeader
        title="Trips"
        subtitle="Plan and log your park days together."
        icon="map"
        right={
          <PrimaryButton
            label="Create"
            icon="add-outline"
            onPress={openCreate}
            testID="trips-create"
          />
        }
      />

      {/* R19.6 / R18.5: transient "no longer available" notice, if queued. */}
      {notice !== null ? (
        <NoticeBanner message={notice} onDismiss={clearTripsListNotice} />
      ) : null}

      {/* Pending invitations: an in-app path to accept/decline. */}
      {invites.length > 0 ? (
        <InvitationsSection
          invites={invites}
          pendingInviteId={pendingInviteId}
          actionBusy={inviteActionBusy}
          onAccept={(inviteId) => acceptInviteMutation.mutate(inviteId)}
          onDecline={(inviteId) => declineInviteMutation.mutate(inviteId)}
        />
      ) : null}

      {/* Empty state (R16.9): only after a successful read of zero Trips. */}
      {totalTrips === 0 && invites.length === 0 ? (
        <View style={styles.center} testID="trips-empty">
          <EmptyState
            icon="map-outline"
            title="No trips yet"
            body="Create a Trip to plan your park days and log them together with friends."
          />
          <PrimaryButton
            label="Create a Trip"
            icon="add-outline"
            onPress={openCreate}
            testID="trips-empty-create"
            style={styles.retryBtn}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return <SectionHeader label={item.label} />;
            }
            return (
              <TripRow
                trip={item.trip}
                onPress={() => {
                  navigation.navigate('TripDetail', { tripId: item.trip.id });
                }}
              />
            );
          }}
          contentContainerStyle={styles.listContent}
        />
      )}

      <CreateTripModal
        visible={createVisible}
        name={draftName}
        description={draftDescription}
        startDate={draftStart}
        endDate={draftEnd}
        error={createError}
        busy={createBusy}
        resorts={resortsQuery.data ?? []}
        selectedResortIds={draftResortIds}
        onToggleResort={toggleResort}
        onChangeName={(value) => {
          setDraftName(value);
          if (createError !== null) setCreateError(null);
        }}
        onChangeDescription={(value) => {
          setDraftDescription(value);
          if (createError !== null) setCreateError(null);
        }}
        onChangeStart={(value) => {
          setDraftStart(value);
          if (createError !== null) setCreateError(null);
        }}
        onChangeEnd={(value) => {
          setDraftEnd(value);
          if (createError !== null) setCreateError(null);
        }}
        onSubmit={() => {
          setCreateError(null);
          createMutation.mutate();
        }}
        onCancel={() => {
          if (createBusy) return;
          setCreateVisible(false);
          resetCreateForm();
        }}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Rows + components
// ---------------------------------------------------------------------------

/**
 * Flatten the server's ordered groups into header + Trip rows. The groups are
 * already in presentation order with empty groups omitted (R16.2–R16.5), so
 * this preserves order and emits one header per non-empty group.
 */
function buildRows(groups: TripsListResponse): readonly Row[] {
  const rows: Row[] = [];
  for (const group of groups) {
    if (group.trips.length === 0) continue;
    rows.push({
      kind: 'header',
      id: `header-${group.status}`,
      label: STATUS_META[group.status].label,
    });
    for (const trip of group.trips) {
      rows.push({ kind: 'trip', id: `trip-${trip.id}`, trip });
    }
  }
  return rows;
}

/**
 * Dismissible banner for a queued Trips-list notice (R19.6, R18.5). Rendered
 * near the top of the list when a fallback navigation left a message to show.
 */
function NoticeBanner({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <View style={styles.notice} accessibilityRole="alert" testID="trips-notice">
      <Ionicons
        name="information-circle-outline"
        size={18}
        color={theme.color.warningText}
        style={styles.noticeIcon}
      />
      <Text style={styles.noticeText}>{message}</Text>
      <Ionicons
        name="close"
        size={18}
        color={theme.color.warningText}
        onPress={onDismiss}
        testID="trips-notice-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Dismiss message"
      />
    </View>
  );
}

function SectionHeader({ label }: { readonly label: string }): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

/**
 * The pending-invitations section shown at the top of the Trips list. Each
 * invite carries who invited the User and to which Trip, plus Accept/Decline
 * controls that post to `/me/trip-invites/:inviteId/{accept,decline}`. Only the
 * invite currently mid-action shows a busy state; all controls disable while
 * any action is in flight to avoid double-submits.
 */
function InvitationsSection({
  invites,
  pendingInviteId,
  actionBusy,
  onAccept,
  onDecline,
}: {
  readonly invites: readonly TripIncomingInviteDTO[];
  readonly pendingInviteId: string | null;
  readonly actionBusy: boolean;
  readonly onAccept: (inviteId: string) => void;
  readonly onDecline: (inviteId: string) => void;
}): JSX.Element {
  return (
    <View style={styles.invitesSection} testID="trips-invitations">
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>Trip Invitations</Text>
      </View>
      {invites.map((invite) => {
        const rowBusy = pendingInviteId === invite.inviteId;
        return (
          <Card
            key={invite.inviteId}
            accentColor={theme.color.primary}
            style={styles.inviteCard}
            testID={`trips-invite-${invite.inviteId}`}
          >
            <Text style={styles.rowName} numberOfLines={1}>
              {invite.tripName}
            </Text>
            <Text style={styles.rowDates}>
              {invite.startDate === invite.endDate
                ? invite.startDate
                : `${invite.startDate} \u2013 ${invite.endDate}`}
            </Text>
            <Text style={styles.inviteMeta} numberOfLines={1}>
              Invited by {invite.inviterDisplayName}
            </Text>
            <View style={styles.inviteActions}>
              <PrimaryButton
                label={rowBusy ? 'Joining\u2026' : 'Accept'}
                icon="checkmark-outline"
                onPress={() => onAccept(invite.inviteId)}
                disabled={actionBusy}
                testID={`trips-invite-accept-${invite.inviteId}`}
                style={styles.flexBtn}
              />
              <SecondaryButton
                label="Decline"
                icon="close-outline"
                onPress={() => onDecline(invite.inviteId)}
                disabled={actionBusy}
                testID={`trips-invite-decline-${invite.inviteId}`}
                style={styles.flexBtn}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function TripRow({
  trip,
  onPress,
}: {
  readonly trip: TripDTO;
  readonly onPress: () => void;
}): JSX.Element {
  const statusMeta = STATUS_META[trip.status];
  return (
    <Card
      accentColor={statusMeta.color}
      style={styles.row}
      onPress={onPress}
      testID={`trips-trip-${trip.id}`}
    >
      <View style={styles.rowMain}>
        <View style={styles.rowIdentity}>
          <Text style={styles.rowName} numberOfLines={1}>
            {trip.name}
          </Text>
          <Text style={styles.rowDates}>{formatDateRange(trip)}</Text>
        </View>
        <Badge label={statusMeta.label} color={statusMeta.color} />
      </View>
    </Card>
  );
}

interface CreateTripModalProps {
  readonly visible: boolean;
  readonly name: string;
  readonly description: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly error: string | null;
  readonly busy: boolean;
  readonly resorts: readonly ResortDTO[];
  readonly selectedResortIds: readonly string[];
  readonly onToggleResort: (resortId: string) => void;
  readonly onChangeName: (value: string) => void;
  readonly onChangeDescription: (value: string) => void;
  readonly onChangeStart: (value: string) => void;
  readonly onChangeEnd: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

function CreateTripModal({
  visible,
  name,
  description,
  startDate,
  endDate,
  error,
  busy,
  resorts,
  selectedResortIds,
  onToggleResort,
  onChangeName,
  onChangeDescription,
  onChangeStart,
  onChangeEnd,
  onSubmit,
  onCancel,
}: CreateTripModalProps): JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard} testID="trips-create-modal">
          <Text style={styles.modalTitle}>Create a Trip</Text>

          <Text style={styles.label}>Trip name</Text>
          <TextInput
            value={name}
            onChangeText={onChangeName}
            placeholder="e.g. Spring Break at WDW"
            placeholderTextColor={theme.color.textSecondary}
            maxLength={100}
            editable={!busy}
            style={styles.input}
            accessibilityLabel="Trip name"
            testID="trips-create-name"
          />

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={onChangeDescription}
            placeholder="What's the plan?"
            placeholderTextColor={theme.color.textSecondary}
            multiline
            maxLength={2000}
            editable={!busy}
            style={[styles.input, styles.inputMultiline]}
            accessibilityLabel="Trip description"
            testID="trips-create-description"
          />

          <Text style={styles.label}>Start date</Text>
          <DatePickerField
            value={startDate}
            onChange={onChangeStart}
            placeholder="Select a date"
            disabled={busy}
            accessibilityLabel="Trip start date"
            testID="trips-create-start"
          />

          <Text style={styles.label}>End date</Text>
          <DatePickerField
            value={endDate}
            onChange={onChangeEnd}
            placeholder="Select a date"
            disabled={busy}
            {...(startDate.trim().length > 0
              ? { minimumDate: startDate }
              : {})}
            accessibilityLabel="Trip end date"
            testID="trips-create-end"
          />

          {resorts.length > 0 ? (
            <>
              <Text style={styles.label}>Where you stayed (optional)</Text>
              <ResortPicker
                resorts={resorts}
                selectedIds={selectedResortIds}
                onToggle={onToggleResort}
                disabled={busy}
                testIDPrefix="trips-create"
              />
            </>
          ) : null}

          {error !== null ? (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              testID="trips-create-error"
            >
              {error}
            </Text>
          ) : null}

          <View style={styles.modalActions}>
            <PrimaryButton
              label={busy ? 'Creating\u2026' : 'Create'}
              onPress={onSubmit}
              disabled={busy}
              testID="trips-create-submit"
              style={styles.flexBtn}
            />
            <SecondaryButton
              label="Cancel"
              onPress={onCancel}
              disabled={busy}
              testID="trips-create-cancel"
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

/**
 * First Zod issue message for the create form. The shared schema uses error
 * codes (e.g. `trip_validation_failed`) as messages; map the known ones to
 * friendly copy and fall back to a generic validation message.
 */
function firstIssueMessage(error: {
  readonly issues: readonly { readonly message: string }[];
}): string {
  const raw = error.issues[0]?.message ?? 'trip_validation_failed';
  switch (raw) {
    case 'trip_validation_failed':
      return 'Please enter a trip name and valid start/end dates (YYYY-MM-DD, end on or after start).';
    default:
      return raw;
  }
}

/** Map an API/validation error to user-facing copy for the Trips screen. */
function tripsErrorMessage(err: ApiError | null): string {
  if (err === null) {
    return 'Something went wrong. Please try again.';
  }
  switch (err.code) {
    case 'trip_validation_failed':
      return err.message;
    case 'validation_failed':
      return 'Please check the trip details and try again.';
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.warningSurface,
    borderWidth: 1,
    borderColor: theme.color.warning,
  },
  noticeIcon: {
    marginTop: 1,
  },
  noticeText: {
    ...theme.typography.meta,
    color: theme.color.warningText,
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  invitesSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  inviteCard: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  inviteMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  sectionHeader: {
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  sectionHeaderText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    marginBottom: theme.spacing.md,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  rowIdentity: {
    flexShrink: 1,
    gap: theme.spacing.xs,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rowDates: {
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
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  error: {
    color: theme.color.danger,
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
