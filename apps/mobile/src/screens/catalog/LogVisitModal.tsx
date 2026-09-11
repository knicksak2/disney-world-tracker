// Feature: experience-activity-logging, Task 5.1 — "Log Visit / Ride Again" modal
//
// Validates: Requirements 6.3 (visit date defaulting to today, optional 1-10
//            rating, optional note, active-Trip selection), 1.1, 1.2
//
// A modal sheet that posts `POST /me/experiences/:id/logs`. The visit date
// defaults to today in the device time zone (a YYYY-MM-DD text field, mirroring
// CompletionControls so we bundle no TZ database and add no native date-picker
// dependency). The rating is an optional 1-10 picker (tap a selected value again
// to clear it); the note is an optional multiline field; the Trip selector lists
// the caller's currently-active Trips read from `GET /me/trips`.

import React, { useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';

import type {
  CreateExperienceLogInput,
  ExperienceLogDTO,
  TripDTO,
  TripStatus,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LogVisitModalProps {
  /** Stable internal Experience id the log is created for. */
  readonly experienceId: string;
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without logging. */
  readonly onClose: () => void;
  /**
   * Invoked after a successful `POST`. The parent uses it to invalidate the
   * visit-history, completion, rating, aggregate, and stats queries (R6.5).
   */
  readonly onLogged: () => void;
}

/** Wire shape of `GET /me/trips`: non-empty status groups in display order. */
type TripsListResponse = readonly { status: TripStatus; trips: readonly TripDTO[] }[];

const RATING_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_NOTE_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Time-zone / date helpers (mirror CompletionControls)
// ---------------------------------------------------------------------------

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

function activeTripsOf(data: TripsListResponse | undefined): readonly TripDTO[] {
  if (data === undefined) return [];
  return data.find((group) => group.status === 'active')?.trips ?? [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LogVisitModal({
  experienceId,
  visible,
  onClose,
  onLogged,
}: LogVisitModalProps): JSX.Element {
  const tz = deviceTimeZone();
  const today = ymdInTimeZone(new Date(), tz);

  const [visitedOn, setVisitedOn] = useState<string>(today);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [tripId, setTripId] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const encodedId = encodeURIComponent(experienceId);

  // Only fetch the caller's Trips while the modal is open (R6.3). The active
  // group is the set of Trips a visit can be attributed to.
  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: () => apiRequest<TripsListResponse>('GET', '/me/trips'),
    enabled: visible,
  });
  const activeTrips = activeTripsOf(tripsQuery.data);

  function resetAndClose(): void {
    if (busy) return;
    setVisitedOn(today);
    setRating(null);
    setNote('');
    setTripId(null);
    setError(null);
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (busy) return;
    const trimmedNote = note.trim();
    if (!isValidIsoDate(visitedOn)) {
      setError('Enter a date as YYYY-MM-DD.');
      return;
    }
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      setError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      return;
    }

    const payload: CreateExperienceLogInput = {
      visitedOn,
      userTz: tz,
      rating,
      note: trimmedNote.length > 0 ? trimmedNote : null,
      tripId,
    };

    setBusy(true);
    setError(null);
    try {
      await apiRequest<ExperienceLogDTO>(
        'POST',
        `/me/experiences/${encodedId}/logs`,
        payload,
      );
      onLogged();
      resetAndCloseAfterSuccess();
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  // Reset local state after a successful submit without the `busy` guard that
  // `resetAndClose` applies (we are still inside the submit's finally window).
  function resetAndCloseAfterSuccess(): void {
    setVisitedOn(today);
    setRating(null);
    setNote('');
    setTripId(null);
    setError(null);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={resetAndClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="log-visit-modal">
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text style={styles.title}>Log a visit</Text>

            {/* Visit date */}
            <Text style={styles.fieldLabel}>Visit date</Text>
            <DatePickerField
              value={visitedOn}
              onChange={setVisitedOn}
              disabled={busy}
              maximumDate={today}
              accessibilityLabel="Visit date"
              testID="log-visit-date"
            />

            {/* Optional rating */}
            <Text style={styles.fieldLabel}>Rating (optional)</Text>
            <View style={styles.pickerRow}>
              {RATING_VALUES.map((value) => {
                const selected = rating === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`Rate ${value} out of 10`}
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => setRating(selected ? null : value)}
                    style={[
                      styles.pickerButton,
                      selected ? styles.pickerButtonSelected : null,
                    ]}
                    testID={`log-visit-rating-${value}`}
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

            {/* Optional note */}
            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="How was it?"
              multiline
              maxLength={MAX_NOTE_LENGTH}
              editable={!busy}
              style={[styles.input, styles.noteInput]}
              accessibilityLabel="Visit note"
              testID="log-visit-note-input"
            />

            {/* Active-trip selector. Only shown when the caller has at least
                one active Trip to attribute the visit to; with none, a lone
                always-selected "No trip" chip communicates nothing, so the
                whole section is omitted (R6.3). */}
            {activeTrips.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>Trip (optional)</Text>
                <View style={styles.pickerRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="No trip"
                    accessibilityState={{
                      selected: tripId === null,
                      disabled: busy,
                    }}
                    disabled={busy}
                    onPress={() => setTripId(null)}
                    style={[
                      styles.tripChip,
                      tripId === null ? styles.tripChipSelected : null,
                    ]}
                    testID="log-visit-trip-none"
                  >
                    <Text
                      style={[
                        styles.tripChipText,
                        tripId === null ? styles.tripChipTextSelected : null,
                      ]}
                    >
                      No trip
                    </Text>
                  </Pressable>
                  {activeTrips.map((trip) => {
                    const selected = tripId === trip.id;
                    return (
                      <Pressable
                        key={trip.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Log to trip ${trip.name}`}
                        accessibilityState={{ selected, disabled: busy }}
                        disabled={busy}
                        onPress={() => setTripId(trip.id)}
                        style={[
                          styles.tripChip,
                          selected ? styles.tripChipSelected : null,
                        ]}
                        testID={`log-visit-trip-${trip.id}`}
                      >
                        <Text
                          style={[
                            styles.tripChipText,
                            selected ? styles.tripChipTextSelected : null,
                          ]}
                        >
                          {trip.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {error !== null ? (
              <Text style={styles.errorText} testID="log-visit-error">
                {error}
              </Text>
            ) : null}

            <View style={styles.actionRow}>
              <SecondaryButton
                label="Cancel"
                accessibilityLabel="Cancel logging a visit"
                disabled={busy}
                onPress={resetAndClose}
                testID="log-visit-cancel"
              />
              <PrimaryButton
                label={busy ? 'Logging\u2026' : 'Log visit'}
                icon="checkmark-circle-outline"
                accessibilityLabel="Save this visit"
                disabled={busy}
                onPress={() => {
                  void handleSubmit();
                }}
                testID="log-visit-submit"
              />
              {busy ? (
                <ActivityIndicator
                  accessibilityLabel="Saving visit"
                  color={theme.color.primary}
                  testID="log-visit-busy"
                />
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'rating_out_of_range') return 'Rating must be 1-10.';
    if (err.code === 'note_length_invalid') {
      return `Note must be 1-${MAX_NOTE_LENGTH} characters.`;
    }
    if (err.code === 'trip_forbidden') {
      return 'You are not a member of that trip.';
    }
    if (err.code === 'log_future_date') {
      return "Visit date can't be in the future.";
    }
    return err.message;
  }
  return 'Could not log this visit. Please try again.';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '85%',
  },
  sheetContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  title: {
    ...theme.typography.title,
    color: theme.color.textPrimary,
  },
  fieldLabel: {
    ...theme.typography.subtitle,
    color: theme.color.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
  },
  noteInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pickerButton: {
    minWidth: 40,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  pickerButtonText: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  pickerButtonTextSelected: {
    color: theme.color.textOnPrimary,
  },
  tripChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    backgroundColor: theme.color.surfaceAlt,
  },
  tripChipSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  tripChipText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  tripChipTextSelected: {
    color: theme.color.textOnPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
});
