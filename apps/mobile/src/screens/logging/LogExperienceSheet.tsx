// Feature: unified-experience-logging, Task 6.3 — Unified Log Experience Sheet
//
// Validates: Requirements 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
//            3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6,
//            6.8, 6.9, 7.1, 7.6, 14.1, 14.2, 14.4

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  buildLogSubmission,
  formatLogToast,
  offersDishPrompt,
  preselectTripId,
  reconcileDraft,
  ridingWithCandidates,
  ridingWithLabel,
  type LogDraft,
  type LogTripRef,
  type TripDTO,
  type TripMemberDTO,
  type TripStatus,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { AppTheme } from '../../theme/theme';
import { useAppTheme } from '../../theme/useAppTheme';
import { useKeyboardBottomInset } from '../../hooks/useKeyboardBottomInset';
import PinCelebrationModal from '../profile/PinCelebrationModal';
import { invalidateAfterLog } from './invalidateAfterLog';
import { useLogToastStore } from './logToastStore';

export interface LogExperienceSheetProps {
  readonly experienceId: string;
  readonly experience?: {
    readonly name: string;
    readonly category: string | null;
    readonly park?: string | null | undefined;
  } | undefined;
  readonly visible: boolean;
  readonly lockedTripId?: string | undefined;
  readonly testIDPrefix?: 'log-visit' | 'activity-log' | undefined;
  readonly onClose: () => void;
  readonly onLogged?: (() => void) | undefined;
}

type TripsListResponse = readonly {
  status: TripStatus;
  trips: readonly TripDTO[];
}[];

interface MeResponse {
  readonly user: { readonly id: string };
}

const RATING_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_NOTE_LENGTH = 2000;

function deviceTimeZone(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC';
}

function ymdInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }
  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const yyyy = parsed.getUTCFullYear().toString().padStart(4, '0');
  const mm = (parsed.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = parsed.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` === value;
}

function activeTripsOf(data: TripsListResponse | undefined): readonly LogTripRef[] {
  if (!Array.isArray(data)) return [];
  const active: readonly TripDTO[] = data.find((g) => g.status === 'active')?.trips ?? [];
  return active.map((t: TripDTO): LogTripRef => ({
    id: t.id,
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
  }));
}

export default function LogExperienceSheet({
  experienceId,
  experience,
  visible,
  lockedTripId,
  testIDPrefix = 'log-visit',
  onClose,
  onLogged,
}: LogExperienceSheetProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();
  const tz = deviceTimeZone();
  const today = ymdInTimeZone(new Date(), tz);

  const { keyboardInset, getAvailableModalHeight } =
    useKeyboardBottomInset(visible);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasInteractedWithTrip = useRef(false);

  // Queries
  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    enabled: visible,
  });

  const activeTrips = useMemo(
    () => activeTripsOf(tripsQuery.data),
    [tripsQuery.data],
  );

  const lockedTripQuery = useQuery<TripDTO, ApiError>({
    queryKey: ['trips', lockedTripId] as const,
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${lockedTripId}`),
    enabled: visible && Boolean(lockedTripId),
  });

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'] as const,
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    enabled: visible,
  });

  const expQuery = useQuery<{ name: string; category: string | null }, ApiError>({
    queryKey: ['experience', experienceId] as const,
    queryFn: () =>
      apiRequest<{ name: string; category: string | null }>(
        'GET',
        `/catalog/${encodeURIComponent(experienceId)}`,
      ),
    enabled: visible && !experience,
  });

  // State
  const [draft, setDraft] = useState<LogDraft>(() => ({
    visitedOn: today,
    rating: null,
    note: '',
    tripId: lockedTripId ?? null,
    rodeWith: [],
  }));

  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebratingPinIds, setCelebratingPinIds] = useState<
    readonly string[]
  >([]);

  // Preselect single active trip when opened unlocked
  useEffect(() => {
    if (visible && !lockedTripId && !hasInteractedWithTrip.current) {
      const preselected = preselectTripId(activeTrips, draft.visitedOn);
      if (preselected !== null) {
        setDraft((prev) => ({ ...prev, tripId: preselected }));
      }
    }
  }, [visible, activeTrips, draft.visitedOn, lockedTripId]);

  // Reset when visibility becomes false
  useEffect(() => {
    if (!visible) {
      hasInteractedWithTrip.current = false;
      setDraft({
        visitedOn: today,
        rating: null,
        note: '',
        tripId: lockedTripId ?? null,
        rodeWith: [],
      });
      setHint(null);
      setError(null);
      setBusy(false);
    }
  }, [visible, today, lockedTripId]);

  // Selected trip lookup
  const currentTrip: LogTripRef | null = useMemo(() => {
    if (lockedTripId && lockedTripQuery.data) {
      const lt = lockedTripQuery.data;
      return {
        id: lt.id,
        name: lt.name,
        startDate: lt.startDate,
        endDate: lt.endDate,
      };
    }
    if (draft.tripId) {
      const at = activeTrips.find((t) => t.id === draft.tripId);
      if (at) return at;
    }
    return null;
  }, [lockedTripId, lockedTripQuery.data, draft.tripId, activeTrips]);

  // Members query for riding-with candidates
  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', draft.tripId] as const,
    queryFn: () =>
      apiRequest<readonly TripMemberDTO[]>(
        'GET',
        `/trips/${draft.tripId}/members`,
      ),
    enabled: visible && Boolean(draft.tripId),
  });

  const callerUserId = meQuery.data?.user?.id ?? '';
  const candidates = useMemo(() => {
    if (!membersQuery.data) return [];
    return ridingWithCandidates(membersQuery.data, callerUserId);
  }, [membersQuery.data, callerUserId]);

  const effectiveName = experience?.name ?? expQuery.data?.name ?? 'Experience';
  const effectiveCategory =
    experience?.category ?? expQuery.data?.category ?? null;

  // Date bounds
  const minDate = currentTrip ? currentTrip.startDate : undefined;
  const maxDate = currentTrip
    ? currentTrip.endDate < today
      ? currentTrip.endDate
      : today
    : today;

  function handleDateChange(newDate: string): void {
    const reconciled = reconcileDraft(
      draft,
      { visitedOn: newDate },
      activeTrips,
      lockedTripId ?? null,
    );
    setDraft(reconciled.draft);
    setHint(reconciled.hint);
    if (error !== null) setError(null);
  }

  function handleTripChange(newTripId: string | null): void {
    hasInteractedWithTrip.current = true;
    const reconciled = reconcileDraft(
      draft,
      { tripId: newTripId },
      activeTrips,
      lockedTripId ?? null,
    );
    setDraft(reconciled.draft);
    setHint(reconciled.hint);
    if (error !== null) setError(null);
  }

  function handleRatingPress(value: number): void {
    if (busy) return;
    setDraft((prev) => ({
      ...prev,
      rating: prev.rating === value ? null : value,
    }));
    if (error !== null) setError(null);
  }

  function handleToggleRider(memberUserId: string): void {
    if (busy) return;
    const exists = draft.rodeWith.includes(memberUserId);
    const updated = exists
      ? draft.rodeWith.filter((id) => id !== memberUserId)
      : [...draft.rodeWith, memberUserId];
    setDraft((prev) => ({ ...prev, rodeWith: updated }));
    if (error !== null) setError(null);
  }

  function resetAndClose(): void {
    if (busy) return;
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (busy) return;
    Keyboard.dismiss();

    const trimmedNote = draft.note.trim();
    if (!isValidIsoDate(draft.visitedOn)) {
      setError('Enter a date as YYYY-MM-DD.');
      return;
    }
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      setError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const submission = buildLogSubmission({
        experienceId,
        draft,
        userTz: tz,
        lockedTripId: lockedTripId ?? null,
        callerUserId,
      });

      const res = await apiRequest<{
        readonly newlyAwardedPinIds?: readonly string[];
      }>('POST', submission.path, submission.body);

      // Invalidate queries
      invalidateAfterLog(queryClient, {
        experienceId,
        tripId: draft.tripId,
      });

      // Prepare tagged names
      const membersList = membersQuery.data ?? [];
      const taggedNames: string[] = [];
      for (const rId of draft.rodeWith) {
        const mem = membersList.find((m) => m.userId === rId);
        if (mem?.displayName) {
          taggedNames.push(mem.displayName);
        }
      }

      const toastMessage = formatLogToast({
        experienceName: effectiveName,
        tripName: currentTrip?.name ?? null,
        taggedNames,
      });

      useLogToastStore.getState().show({
        message: toastMessage,
        tripId: draft.tripId,
        experienceId,
        offerDishPrompt: offersDishPrompt(effectiveCategory),
      });

      onLogged?.();

      const newPins = res?.newlyAwardedPinIds ?? [];
      onClose();

      if (Array.isArray(newPins) && newPins.length > 0) {
        setCelebratingPinIds(newPins);
      }
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  const riderLabel = ridingWithLabel(effectiveCategory);

  return (
    <>
      <Modal
        visible={visible && celebratingPinIds.length === 0}
        transparent
        animationType="slide"
        onRequestClose={resetAndClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.backdrop,
            Platform.OS === 'android' && keyboardInset > 0
              ? { paddingBottom: keyboardInset }
              : null,
          ]}
          testID={`${testIDPrefix}-keyboard-avoiding-view`}
        >
          <View
            style={[
              styles.sheet,
              Platform.OS === 'android' && keyboardInset > 0
                ? { maxHeight: getAvailableModalHeight(40) }
                : null,
            ]}
            testID={`${testIDPrefix}-modal`}
          >
            <View testID={`${testIDPrefix}-composer`}>
              <ScrollView
                ref={scrollViewRef}
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                testID={`${testIDPrefix}-scroll`}
              >
              <Text style={styles.title}>
                {lockedTripId ? 'Log Activity' : 'Log a visit'}
              </Text>
              <View testID={`${testIDPrefix}-selected`}>
                <Text style={styles.experienceName} numberOfLines={2}>
                  {effectiveName}
                </Text>
              </View>

              {/* Today / Visit date row */}
              <View testID={`${testIDPrefix}-date-row`}>
                <Text style={styles.fieldLabel}>Visit date</Text>
                <DatePickerField
                  value={draft.visitedOn}
                  onChange={handleDateChange}
                  disabled={busy}
                  minimumDate={minDate}
                  maximumDate={maxDate}
                  accessibilityLabel="Visit date"
                  testID={`${testIDPrefix}-date`}
                />
                {hint === 'date_outside_trip' && (
                  <Text
                    style={styles.hintText}
                    testID={`${testIDPrefix}-date-hint`}
                  >
                    That date is outside this trip's dates.
                  </Text>
                )}
              </View>

              {/* Rating tiles */}
              <View>
                <Text style={styles.fieldLabel}>Rating (optional)</Text>
                <View style={styles.pickerRow}>
                  {RATING_VALUES.map((value) => {
                    const selected = draft.rating === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityLabel={`Rate ${value} out of 10`}
                        accessibilityState={{ selected, disabled: busy }}
                        disabled={busy}
                        onPress={() => handleRatingPress(value)}
                        style={[
                          styles.pickerButton,
                          selected ? styles.pickerButtonSelected : null,
                        ]}
                        testID={`${testIDPrefix}-rating-${value}`}
                      >
                        <Text
                          style={[
                            styles.pickerButtonText,
                            selected ? styles.pickerButtonTextSelected : null,
                          ]}
                        >
                          {value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Add a note row */}
              <View testID={`${testIDPrefix}-note-row`}>
                <Text style={styles.fieldLabel}>Note (optional)</Text>
                <TextInput
                  value={draft.note}
                  onChangeText={(text) => {
                    setDraft((prev) => ({ ...prev, note: text }));
                    if (error !== null) setError(null);
                  }}
                  placeholder="How was it?"
                  placeholderTextColor={
                    t.scheme === 'dark' ? t.color.textSecondary : undefined
                  }
                  keyboardAppearance={t.scheme}
                  multiline
                  maxLength={MAX_NOTE_LENGTH}
                  editable={!busy}
                  style={[styles.input, styles.noteInput]}
                  accessibilityLabel="Visit note"
                  testID={`${testIDPrefix}-note-input`}
                  onFocus={() => {
                    setTimeout(() => {
                      scrollViewRef.current?.scrollTo({
                        y: 180,
                        animated: true,
                      });
                    }, 100);
                  }}
                />
              </View>

              {/* Trip section */}
              {lockedTripId ? (
                <View testID={`${testIDPrefix}-trip-locked`}>
                  <Text style={styles.fieldLabel}>Trip</Text>
                  <View style={styles.lockedTripChip}>
                    <Text style={styles.lockedTripText}>
                      {currentTrip?.name ?? 'Trip'}
                    </Text>
                  </View>
                </View>
              ) : activeTrips.length > 0 ? (
                <View>
                  <Text style={styles.fieldLabel}>Trip (optional)</Text>
                  <View style={styles.pickerRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="No trip"
                      accessibilityState={{
                        selected: draft.tripId === null,
                        disabled: busy,
                      }}
                      disabled={busy}
                      onPress={() => handleTripChange(null)}
                      style={[
                        styles.chip,
                        draft.tripId === null ? styles.chipSelected : null,
                      ]}
                      testID={`${testIDPrefix}-trip-none`}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          draft.tripId === null ? styles.chipTextSelected : null,
                        ]}
                      >
                        No trip
                      </Text>
                    </Pressable>

                    {activeTrips.map((trip) => {
                      const selected = draft.tripId === trip.id;
                      return (
                        <Pressable
                          key={trip.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Log to trip ${trip.name}`}
                          accessibilityState={{ selected, disabled: busy }}
                          disabled={busy}
                          onPress={() => handleTripChange(trip.id)}
                          style={[
                            styles.chip,
                            selected ? styles.chipSelected : null,
                          ]}
                          testID={`${testIDPrefix}-trip-${trip.id}`}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              selected ? styles.chipTextSelected : null,
                            ]}
                          >
                            {trip.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Riding with / Dined with section */}
              {draft.tripId !== null && (
                <View>
                  <Text style={styles.fieldLabel}>{riderLabel}</Text>
                  {membersQuery.isError ? (
                    <View style={styles.membersErrorRow}>
                      <Text style={styles.membersErrorText}>
                        Could not load trip members.
                      </Text>
                      <Pressable
                        onPress={() => membersQuery.refetch()}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading members"
                        testID={`${testIDPrefix}-members-retry`}
                      >
                        <Text style={styles.retryText}>Retry</Text>
                      </Pressable>
                    </View>
                  ) : candidates.length === 0 ? (
                    <Text
                      style={styles.helperText}
                      testID={`${testIDPrefix}-no-candidates`}
                    >
                      No other Members to tag yet. You can still log this on your
                      own.
                    </Text>
                  ) : (
                    <View
                      style={styles.pickerRow}
                      testID={`${testIDPrefix}-rodewith`}
                    >
                      {candidates.map((member) => {
                        const selected = draft.rodeWith.includes(member.userId);
                        return (
                          <Pressable
                            key={member.userId}
                            accessibilityRole="button"
                            accessibilityLabel={`Tag ${member.displayName}`}
                            accessibilityState={{ selected, disabled: busy }}
                            disabled={busy}
                            onPress={() => handleToggleRider(member.userId)}
                            style={[
                              styles.chip,
                              selected ? styles.chipSelected : null,
                            ]}
                            testID={`${testIDPrefix}-member-${member.userId}`}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                selected ? styles.chipTextSelected : null,
                              ]}
                            >
                              {member.displayName}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* Error text */}
              {error !== null && (
                <Text style={styles.errorText} testID={`${testIDPrefix}-error`}>
                  {error}
                </Text>
              )}

              {/* Action buttons */}
              <View style={styles.actionRow}>
                <SecondaryButton
                  label="Cancel"
                  accessibilityLabel="Cancel logging a visit"
                  disabled={busy}
                  onPress={resetAndClose}
                  testID={`${testIDPrefix}-cancel`}
                />
                <PrimaryButton
                  label={busy ? 'Logging\u2026' : 'Log visit'}
                  icon="checkmark-circle-outline"
                  accessibilityLabel="Save this visit"
                  disabled={busy}
                  onPress={() => {
                    void handleSubmit();
                  }}
                  testID={`${testIDPrefix}-submit`}
                />
                {busy && (
                  <ActivityIndicator
                    accessibilityLabel="Saving visit"
                    color={t.color.primaryFg}
                    testID={`${testIDPrefix}-busy`}
                  />
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
      </Modal>

      {celebratingPinIds.length > 0 && (
        <PinCelebrationModal
          visible={celebratingPinIds.length > 0}
          pinIds={celebratingPinIds}
          onClose={() => setCelebratingPinIds([])}
        />
      )}
    </>
  );
}

function messageForError(err: unknown): string {
  const code =
    err instanceof ApiError
      ? err.code
      : typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';

  if (code === 'log_outside_trip_dates') {
    return "That date is outside this trip's dates.";
  }
  if (code === 'log_future_date') {
    return 'Visit date cannot be in the future.';
  }
  if (code === 'trip_forbidden') {
    return 'You do not have access to this trip.';
  }
  if (code === 'trip_validation_failed') {
    return 'Could not validate trip members.';
  }
  if (code === 'rating_out_of_range') {
    return 'Rating must be 1-10.';
  }
  if (code === 'note_length_invalid') {
    return `Note must be 1-${MAX_NOTE_LENGTH} characters.`;
  }
  if (err instanceof ApiError && err.message) {
    return err.message;
  }
  return 'Could not log this visit. Please try again.';
}

const useStyles = makeStyles((t: AppTheme) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    maxHeight: '85%',
    width: '100%',
  },
  sheetContent: {
    padding: t.spacing.lg,
    gap: t.spacing.md,
  },
  title: {
    ...t.typography.title,
    color: t.color.textPrimary,
  },
  experienceName: {
    ...t.typography.subtitle,
    color: t.color.textSecondary,
    marginTop: -4,
  },
  fieldLabel: {
    ...t.typography.subtitle,
    color: t.color.textSecondary,
    marginBottom: t.spacing.xs,
  },
  hintText: {
    ...t.typography.meta,
    color: t.color.accent,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
  },
  pickerButton: {
    minWidth: 40,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  pickerButtonText: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
  },
  pickerButtonTextSelected: {
    color: t.color.textOnPrimary,
  },
  chip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surfaceAlt,
  },
  chipSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  chipText: {
    ...t.typography.body,
    color: t.color.textPrimary,
  },
  chipTextSelected: {
    color: t.color.textOnPrimary,
  },
  lockedTripChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  lockedTripText: {
    ...t.typography.body,
    color: t.color.textPrimary,
    fontWeight: '600',
  },
  membersErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  membersErrorText: {
    ...t.typography.meta,
    color: t.color.danger,
  },
  retryText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '700',
  },
  helperText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
  errorText: {
    color: t.color.danger,
    fontSize: 13,
  },
}));