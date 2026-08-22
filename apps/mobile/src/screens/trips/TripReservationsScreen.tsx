// Feature: trip-reservations — the Reservations section of a Trip.
//
// Every booking the group holds, grouped by date: dining, Lightning Lane, and
// other timed reservations (R2.1–R2.7). A Reservation IS a Planned_Item with a
// non-null `reservationKind`, so this screen reads the same
// `GET /trips/:id/planned-items` the Schedule Builder uses and writes through
// the same Planned_Item endpoints — there is no separate reservations endpoint
// and no synchronization step. Adding a booking here makes it appear on the
// Schedule Builder for that date automatically (R4.1), because it is literally
// the same record.
//
// Validates: Requirements 2.1–2.7, 3.1–3.7, 4.1, 4.3, 5.1, 5.2

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
  RESERVATION_KINDS,
  CONFIRMATION_NUMBER_MAX,
  PARTY_SIZE_MAX,
  PARTY_SIZE_MIN,
  type ExperienceDTO,
  type PlannedItemDTO,
  type ReservationKind,
  type TripDTO,
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
  ScreenContainer,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import { formatParkTime } from '../catalog/live/parkTime';
import { tripDetailKeys } from './TripDetailScreen';
import { tripPlannedListKeys } from './TripPlannedListScreen';
import { ExperiencePicker, type ExperiencePickerTab } from './ExperiencePicker';
import {
  countReservations,
  etWallClockToIso,
  formatGroupDate,
  groupReservationsByDate,
  isoToWheelTime,
  reservationKindPresentation,
  reservationTitle,
} from './reservations';
import { TimeWheelPicker } from '../../components/TimeWheelPicker';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripReservations'>;

/**
 * Which slice of the Catalog each kind may choose from (R3.2, R3.3). A dining
 * booking picks a restaurant; a Lightning Lane booking picks a ride. `activity`
 * and `other` stay unrestricted because a tour, cabana, or dessert party can be
 * any kind of Experience — or none at all.
 */
const PICKER_TAB_BY_KIND: Readonly<Record<ReservationKind, ExperiencePickerTab>> = {
  dining: 'dining',
  lightning_lane: 'attractions',
  activity: 'all',
  other: 'all',
};

/** A booking whose venue is not in the Catalog is carried as a titled break (R5.1). */
interface DraftState {
  readonly kind: ReservationKind;
  readonly date: string;
  readonly timeText: string;
  readonly experience: ExperienceDTO | null;
  readonly customTitle: string;
  readonly partySizeText: string;
  readonly confirmationNumber: string;
}

function emptyDraft(date: string): DraftState {
  return {
    kind: 'dining',
    date,
    timeText: '',
    experience: null,
    customTitle: '',
    partySizeText: '',
    confirmationNumber: '',
  };
}

export default function TripReservationsScreen({ navigation, route }: Props): JSX.Element {
  const { tripId } = route.params;
  const queryClient = useQueryClient();

  const tripQuery = useQuery<TripDTO, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
  });

  const itemsQuery = useQuery<readonly PlannedItemDTO[], ApiError>({
    queryKey: tripPlannedListKeys.items(tripId),
    queryFn: () =>
      apiRequest<readonly PlannedItemDTO[]>('GET', `/trips/${tripId}/planned-items`),
  });

  const groups = useMemo(
    () => groupReservationsByDate(itemsQuery.data ?? []),
    [itemsQuery.data],
  );
  const total = countReservations(groups);

  const [showAddModal, setShowAddModal] = useState(false);
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(''));
  const [editing, setEditing] = useState<PlannedItemDTO | null>(null);
  const [editTimeText, setEditTimeText] = useState('');
  const [editPartySizeText, setEditPartySizeText] = useState('');
  const [editConfirmation, setEditConfirmation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: tripPlannedListKeys.items(tripId) });
  };

  const addMutation = useMutation<PlannedItemDTO, ApiError, Record<string, unknown>>({
    mutationFn: (body) =>
      apiRequest<PlannedItemDTO>('POST', `/trips/${tripId}/planned-items`, body),
    onSuccess: () => {
      setShowAddModal(false);
      setFormError(null);
      invalidate();
    },
    onError: (err) => setFormError(err.message || 'Could not save that reservation.'),
  });

  const editMutation = useMutation<
    PlannedItemDTO,
    ApiError,
    { itemId: string; body: Record<string, unknown> }
  >({
    mutationFn: ({ itemId, body }) =>
      apiRequest<PlannedItemDTO>('PATCH', `/trips/${tripId}/planned-items/${itemId}`, body),
    onSuccess: () => {
      setEditing(null);
      setFormError(null);
      invalidate();
    },
    onError: (err) => setFormError(err.message || 'Could not update that reservation.'),
  });

  const deleteMutation = useMutation<void, ApiError, string>({
    mutationFn: async (itemId) => {
      await apiRequest('DELETE', `/trips/${tripId}/planned-items/${itemId}`);
    },
    onSuccess: () => {
      setEditing(null);
      setFormError(null);
      invalidate();
    },
    onError: (err) => setFormError(err.message || 'Could not remove that reservation.'),
  });

  const handleOpenAdd = (): void => {
    setDraft(emptyDraft(tripQuery.data?.startDate ?? ''));
    setFormError(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (item: PlannedItemDTO): void => {
    setEditing(item);
    // Seed the Time_Picker with the stored Booked_Time in park-local 12-hour
    // form so it opens on the reservation's actual time (R3.10).
    setEditTimeText(isoToWheelTime(item.plannedTime));
    setEditPartySizeText(item.partySize == null ? '' : String(item.partySize));
    setEditConfirmation(item.confirmationNumber ?? '');
    setFormError(null);
  };

  /** Shared validation for the party-size and confirmation-number text fields. */
  function readOptionalPartySize(text: string): number | null | 'invalid' {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    if (!/^\d+$/.test(trimmed)) return 'invalid';
    const value = Number.parseInt(trimmed, 10);
    if (value < PARTY_SIZE_MIN || value > PARTY_SIZE_MAX) return 'invalid';
    return value;
  }

  const handleSubmitAdd = (): void => {
    if (draft.date.length === 0) {
      setFormError('Pick a date for this reservation.');
      return;
    }
    // A booking time is a fact, so it must be chosen explicitly rather than
    // defaulted into the payload (R3.11).
    if (draft.timeText.length === 0) {
      setFormError('Pick a time for this reservation.');
      return;
    }
    const plannedTime = etWallClockToIso(draft.date, draft.timeText);
    if (plannedTime === null) {
      setFormError('That time could not be read. Pick an hour, minute, and AM or PM.');
      return;
    }

    const hasVenue = draft.experience != null || draft.customTitle.trim().length > 0;
    if (!hasVenue) {
      setFormError('Choose a place, or type a name for an off-property booking.');
      return;
    }

    const partySize = readOptionalPartySize(draft.partySizeText);
    if (partySize === 'invalid') {
      setFormError(`Party size must be between ${PARTY_SIZE_MIN} and ${PARTY_SIZE_MAX}.`);
      return;
    }

    const confirmation = draft.confirmationNumber.trim();
    if (confirmation.length > CONFIRMATION_NUMBER_MAX) {
      setFormError(`Confirmation number must be ${CONFIRMATION_NUMBER_MAX} characters or fewer.`);
      return;
    }

    // A Catalog booking references the Experience; an off-property one is an
    // unlocated break carrying its own title (R5.1) — the `item_type`
    // vocabulary is not widened.
    const venue =
      draft.experience != null
        ? { experienceId: draft.experience.id }
        : { experienceId: null, itemType: 'break' as const, customTitle: draft.customTitle.trim() };

    addMutation.mutate({
      ...venue,
      plannedDate: draft.date,
      plannedTime,
      reservationKind: draft.kind,
      ...(partySize != null ? { partySize } : {}),
      ...(confirmation.length > 0 ? { confirmationNumber: confirmation } : {}),
    });
  };

  const handleSubmitEdit = (): void => {
    if (editing === null) return;

    const body: Record<string, unknown> = {};

    if (editTimeText.trim().length > 0) {
      const plannedTime = etWallClockToIso(editing.plannedDate ?? '', editTimeText);
      if (plannedTime === null) {
        setFormError('That time could not be read. Pick an hour, minute, and AM or PM.');
        return;
      }
      if (plannedTime !== editing.plannedTime) {
        body.plannedTime = plannedTime;
      }
    }

    const partySize = readOptionalPartySize(editPartySizeText);
    if (partySize === 'invalid') {
      setFormError(`Party size must be between ${PARTY_SIZE_MIN} and ${PARTY_SIZE_MAX}.`);
      return;
    }
    if (partySize !== editing.partySize) {
      body.partySize = partySize;
    }

    const confirmation = editConfirmation.trim();
    if (confirmation.length > CONFIRMATION_NUMBER_MAX) {
      setFormError(`Confirmation number must be ${CONFIRMATION_NUMBER_MAX} characters or fewer.`);
      return;
    }
    const nextConfirmation = confirmation.length === 0 ? null : confirmation;
    if (nextConfirmation !== editing.confirmationNumber) {
      body.confirmationNumber = nextConfirmation;
    }

    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    editMutation.mutate({ itemId: editing.id, body });
  };

  const busy = addMutation.isPending || editMutation.isPending || deleteMutation.isPending;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Reservations"
        subtitle={
          total === 0
            ? (tripQuery.data?.name ?? 'Your bookings')
            : `${total} booking${total === 1 ? '' : 's'} on this trip`
        }
        icon="ticket-outline"
        compact
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scroll} testID="trip-reservations-scroll">
        <PrimaryButton
          label="Add Reservation"
          icon="add-circle-outline"
          onPress={handleOpenAdd}
          testID="reservations-add-button"
        />

        {itemsQuery.isPending ? (
          <ActivityIndicator
            style={styles.loading}
            color={theme.color.primary}
            testID="reservations-loading"
          />
        ) : null}

        {itemsQuery.isError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText} testID="reservations-load-error">
              We could not load your reservations. Pull back and try again.
            </Text>
          </Card>
        ) : null}

        {!itemsQuery.isPending && !itemsQuery.isError && total === 0 ? (
          <EmptyState
            icon="ticket-outline"
            title="No reservations yet"
            body="Add a dining reservation, a Lightning Lane return, or another booking and it will show up on your schedule for that day automatically."
            testID="reservations-empty"
          />
        ) : null}

        {groups.map((group) => (
          <View key={group.date} style={styles.group}>
            <SectionLabel>{formatGroupDate(group.date)}</SectionLabel>
            {group.items.map((item) => (
              <ReservationRow
                key={item.id}
                item={item}
                onPress={() => handleOpenEdit(item)}
                onEdit={() => handleOpenEdit(item)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* ------------------------------------------------------------------ */}
      {/* Add a reservation (R3.1–R3.3)                                      */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <ScreenContainer>
          <GradientHeader
            title="Add Reservation"
            icon="ticket-outline"
            compact
            onBack={() => setShowAddModal(false)}
          />
          <ScrollView contentContainerStyle={styles.scroll}>
            <SectionLabel>Kind</SectionLabel>
            <View style={styles.kindRow}>
              {RESERVATION_KINDS.map((kind) => {
                const presentation = reservationKindPresentation(kind);
                const active = draft.kind === kind;
                return (
                  <Pressable
                    key={kind}
                    onPress={() =>
                      setDraft((prev) => ({ ...prev, kind, experience: null }))
                    }
                    style={[styles.kindChip, active && styles.kindChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={presentation.label}
                    testID={`reservation-kind-${kind}`}
                  >
                    <Ionicons
                      name={presentation.icon as keyof typeof Ionicons.glyphMap}
                      size={16}
                      color={active ? theme.color.surface : theme.color.textSecondary}
                    />
                    <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>
                      {presentation.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionLabel>Date</SectionLabel>
            <View style={styles.dateRow}>
              {tripDates(tripQuery.data).map((date) => {
                const active = draft.date === date;
                return (
                  <Pressable
                    key={date}
                    onPress={() => setDraft((prev) => ({ ...prev, date }))}
                    style={[styles.dateChip, active && styles.dateChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`reservation-date-${date}`}
                  >
                    <Text style={[styles.dateChipText, active && styles.dateChipTextActive]}>
                      {formatGroupDate(date)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionLabel>Time (park time)</SectionLabel>
            {/* Picked, never typed (R3.8). 5-minute steps so a real booking on a
                non-quarter-hour boundary is representable (R3.9). */}
            <Text style={styles.timeReadout} testID="reservation-time-readout">
              {draft.timeText.length > 0 ? draft.timeText : 'No time selected'}
            </Text>
            <TimeWheelPicker
              value={draft.timeText}
              minuteStep={5}
              onChange={(timeText) => {
                setDraft((prev) => ({ ...prev, timeText }));
                setFormError(null);
              }}
              testIDPrefix="reservation-time"
            />

            <SectionLabel>Party size</SectionLabel>
            <TextInput
              value={draft.partySizeText}
              onChangeText={(partySizeText) => setDraft((prev) => ({ ...prev, partySizeText }))}
              placeholder="4"
              placeholderTextColor={theme.color.textSecondary}
              keyboardType="number-pad"
              style={styles.input}
              accessibilityLabel="Party size"
              testID="reservation-party-size-input"
            />

            <SectionLabel>Confirmation number</SectionLabel>
            <TextInput
              value={draft.confirmationNumber}
              onChangeText={(confirmationNumber) =>
                setDraft((prev) => ({ ...prev, confirmationNumber }))
              }
              placeholder="Optional"
              placeholderTextColor={theme.color.textSecondary}
              maxLength={CONFIRMATION_NUMBER_MAX}
              style={styles.input}
              accessibilityLabel="Confirmation number"
              testID="reservation-confirmation-input"
            />

            <SectionLabel>Where</SectionLabel>
            {draft.experience != null ? (
              <Card style={styles.selectedVenue}>
                <Text style={styles.selectedVenueText} testID="reservation-selected-venue">
                  {draft.experience.name}
                </Text>
                <SecondaryButton
                  label="Change"
                  onPress={() => setDraft((prev) => ({ ...prev, experience: null }))}
                  testID="reservation-clear-venue"
                />
              </Card>
            ) : (
              <>
                {/* Keyed on the kind so switching kind remounts the picker and
                    it re-scopes to that kind's categories (R3.2, R3.3).
                    `defaultTab` only seeds the picker's initial tab, so without
                    the key a kind change would leave the previous kind's
                    Catalog slice on screen. Remounting also clears the stale
                    search text, which is the behavior we want anyway. */}
                <ExperiencePicker
                  key={draft.kind}
                  enabled={showAddModal}
                  showTabs={false}
                  defaultTab={PICKER_TAB_BY_KIND[draft.kind]}
                  // Destination chips (R3.13–R3.15). Left unselected by default
                  // so nothing is hidden (R3.14) — a booking is often at a
                  // resort or Disney Springs rather than the day's starting
                  // park, so a "helpful" default would hide exactly the venues
                  // that are hardest to find by name.
                  showParkFilter
                  onSelect={(experience) =>
                    setDraft((prev) => ({ ...prev, experience, customTitle: '' }))
                  }
                  testIDPrefix="reservation-picker"
                />
                <Text style={styles.hint}>Not in the app? Type the name instead.</Text>
                <TextInput
                  value={draft.customTitle}
                  onChangeText={(customTitle) => setDraft((prev) => ({ ...prev, customTitle }))}
                  placeholder="Off-property restaurant"
                  placeholderTextColor={theme.color.textSecondary}
                  style={styles.input}
                  accessibilityLabel="Off-property booking name"
                  testID="reservation-custom-title-input"
                />
              </>
            )}

            {formError !== null ? (
              <Text style={styles.errorText} testID="reservation-form-error">
                {formError}
              </Text>
            ) : null}

            <PrimaryButton
              label={busy ? 'Saving…' : 'Save Reservation'}
              onPress={handleSubmitAdd}
              testID="reservation-save-button"
            />
          </ScrollView>
        </ScreenContainer>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Edit / remove a reservation (R3.4, R3.5)                           */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        visible={editing !== null}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <ScreenContainer>
          <GradientHeader
            title="Edit Reservation"
            {...(editing !== null ? { subtitle: reservationTitle(editing) } : {})}
            icon="ticket-outline"
            compact
            onBack={() => setEditing(null)}
          />
          <ScrollView contentContainerStyle={styles.scroll}>
            <SectionLabel>Time (park time)</SectionLabel>
            {/* Preselected from the stored Booked_Time (R3.10). */}
            <Text style={styles.timeReadout} testID="reservation-edit-time-readout">
              {editTimeText.length > 0 ? editTimeText : 'No time selected'}
            </Text>
            <TimeWheelPicker
              value={editTimeText}
              minuteStep={5}
              onChange={(next) => {
                setEditTimeText(next);
                setFormError(null);
              }}
              testIDPrefix="reservation-edit-time"
            />

            <SectionLabel>Party size</SectionLabel>
            <TextInput
              value={editPartySizeText}
              onChangeText={setEditPartySizeText}
              placeholder="4"
              placeholderTextColor={theme.color.textSecondary}
              keyboardType="number-pad"
              style={styles.input}
              accessibilityLabel="Party size"
              testID="reservation-edit-party-size-input"
            />

            <SectionLabel>Confirmation number</SectionLabel>
            <TextInput
              value={editConfirmation}
              onChangeText={setEditConfirmation}
              placeholder="Optional"
              placeholderTextColor={theme.color.textSecondary}
              maxLength={CONFIRMATION_NUMBER_MAX}
              style={styles.input}
              accessibilityLabel="Confirmation number"
              testID="reservation-edit-confirmation-input"
            />

            {formError !== null ? (
              <Text style={styles.errorText} testID="reservation-edit-error">
                {formError}
              </Text>
            ) : null}

            <PrimaryButton
              label={busy ? 'Saving…' : 'Save Changes'}
              onPress={handleSubmitEdit}
              testID="reservation-edit-save-button"
            />
            {editing?.experienceId ? (
              <SecondaryButton
                label="View Experience Details"
                icon="information-circle-outline"
                onPress={() => {
                  const expId = editing.experienceId;
                  if (expId) {
                    setEditing(null);
                    (navigation as any).navigate('ExperienceDetail', { experienceId: expId });
                  }
                }}
                testID="reservation-view-experience-button"
              />
            ) : null}
            <SecondaryButton
              label="View on Schedule"
              icon="calendar-outline"
              onPress={() => {
                setEditing(null);
                navigation.navigate('TripSchedule', { tripId });
              }}
              testID="reservation-view-schedule-button"
            />
            <SecondaryButton
              label="Remove Reservation"
              onPress={() => {
                if (editing !== null) deleteMutation.mutate(editing.id);
              }}
              testID="reservation-remove-button"
            />
          </ScrollView>
        </ScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}

/**
 * One Reservation row. Kind is conveyed by an icon AND a text badge, never by
 * color alone (R2.3). Pressing the row opens its edit and details view (R2.5).
 */
function ReservationRow({
  item,
  onPress,
  onEdit,
}: {
  readonly item: PlannedItemDTO;
  readonly onPress: () => void;
  readonly onEdit: () => void;
}): JSX.Element {
  const presentation =
    item.reservationKind != null
      ? reservationKindPresentation(item.reservationKind)
      : { icon: 'bookmark-outline', label: 'Reservation' };

  return (
    <Card style={styles.row}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${reservationTitle(item)}, ${presentation.label} at ${formatParkTime(
          item.plannedTime ?? undefined,
        )}`}
        style={styles.rowMain}
        testID={`reservation-row-${item.id}`}
      >
        <View style={styles.rowHeader}>
          <Text style={styles.rowTime} testID={`reservation-time-${item.id}`}>
            {formatParkTime(item.plannedTime ?? undefined)}
          </Text>
          <View style={styles.kindBadge}>
            <Ionicons
              name={presentation.icon as keyof typeof Ionicons.glyphMap}
              size={13}
              color={theme.color.textSecondary}
            />
            <Text style={styles.kindBadgeText} testID={`reservation-kind-label-${item.id}`}>
              {presentation.label}
            </Text>
          </View>
        </View>

        <Text style={styles.rowTitle}>{reservationTitle(item)}</Text>

        <View style={styles.rowMetaLine}>
          {item.park != null ? <Badge label={item.park} color={theme.color.primaryLight} /> : null}
          {item.partySize != null ? (
            <Text style={styles.rowMeta} testID={`reservation-party-${item.id}`}>
              Party of {item.partySize}
            </Text>
          ) : null}
        </View>

        {item.confirmationNumber != null ? (
          <Text style={styles.rowConfirmation} testID={`reservation-confirmation-${item.id}`}>
            Confirmation {item.confirmationNumber}
          </Text>
        ) : null}

        <Text style={styles.rowAdder}>Added by {item.addedByDisplayName}</Text>
      </Pressable>

      <SecondaryButton label="Edit" onPress={onEdit} testID={`reservation-edit-${item.id}`} />
    </Card>
  );
}

/** The Trip's calendar dates, inclusive; empty when the Trip has not loaded. */
function tripDates(trip: TripDTO | undefined): readonly string[] {
  if (trip?.startDate == null) return [];
  const dates: string[] = [];
  const start = new Date(`${trip.startDate}T12:00:00Z`);
  const end = new Date(`${trip.endDate ?? trip.startDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    dates.push(d.toISOString().slice(0, 10));
    if (dates.length > 60) break;
  }
  return dates;
}

const styles = StyleSheet.create({
  scroll: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
  },
  loading: { marginTop: theme.spacing.lg },
  group: { gap: theme.spacing.xs, marginTop: theme.spacing.sm },
  row: { gap: theme.spacing.xs },
  rowMain: { gap: 2 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTime: {
    fontSize: theme.typography.body.fontSize,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  kindBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindBadgeText: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  rowTitle: {
    fontSize: theme.typography.body.fontSize,
    color: theme.color.textPrimary,
  },
  rowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  rowMeta: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  rowConfirmation: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  rowAdder: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  kindChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  kindChipText: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  kindChipTextActive: { color: theme.color.surface, fontWeight: '700' },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  dateChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  dateChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  dateChipText: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  dateChipTextActive: { color: theme.color.surface, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surface,
  },
  selectedVenue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  selectedVenueText: { color: theme.color.textPrimary, flexShrink: 1 },
  hint: {
    fontSize: theme.typography.meta.fontSize,
    color: theme.color.textSecondary,
  },
  // The picked time, echoed in words so the selection is legible without
  // decoding which wheel cells are highlighted.
  timeReadout: {
    fontSize: theme.typography.heading.fontSize,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  errorCard: { borderColor: theme.color.danger, borderWidth: 1 },
  errorText: {
    color: theme.color.danger,
    fontSize: theme.typography.meta.fontSize,
  },
});
