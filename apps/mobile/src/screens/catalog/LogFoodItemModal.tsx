// Feature: food-item-logging, Task 7.2 & 7.5 — Log Food Item Modal
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4, 5.7

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  hasVisitOnDate,
  preselectTripId,
  reconcileDraft,
  ridingWithCandidates,
  type CreateFoodItemLogInputDTO,
  type CreateFoodItemLogResponseDTO,
  type ExperienceVisitHistoryDTO,
  type FoodItemDTO,
  type FoodItemLogDTO,
  type LogTripRef,
  type TripDTO,
  type TripMemberDTO,
  type TripStatus,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { Badge, PrimaryButton, SecondaryButton } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { useKeyboardBottomInset } from '../../hooks/useKeyboardBottomInset';
import { LOG_FOOD } from './LogFoodItemModal.palette';
import { usePhotoConfig, useUploadPhotos } from '../../photos/api';
import { PhotoPickerSheet } from '../../photos/PhotoPickerSheet';
import type { PreparedImages } from '../../photos/imagePrep';
import { invalidateAfterLog } from '../logging/invalidateAfterLog';

export interface LogFoodItemModalProps {
  /** The food item being logged. */
  readonly foodItem: FoodItemDTO | null;
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without logging. */
  readonly onClose: () => void;
  /** Callback after a successful log creation. */
  readonly onLogged?: (log: FoodItemLogDTO) => void;
  /** Optional initial photos to attach upon log creation. */
  readonly initialPhotos?: readonly PreparedImages[];
}

type TripsListResponse =
  | readonly {
      status: TripStatus;
      trips: readonly TripDTO[];
    }[]
  | { readonly trips?: readonly TripDTO[] };

interface MeResponse {
  readonly user?: { readonly id: string };
}

function activeTripsOf(data: TripsListResponse | undefined): readonly LogTripRef[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    const active: readonly TripDTO[] = data.find((g) => g.status === 'active')?.trips ?? [];
    return active.map((t: TripDTO): LogTripRef => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
    }));
  }
  const flatTrips = (data as { readonly trips?: readonly TripDTO[] }).trips ?? [];
  return flatTrips
    .filter((t) => t.status === 'active')
    .map((t): LogTripRef => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
    }));
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

export default function LogFoodItemModal({
  foodItem,
  visible,
  onClose,
  onLogged,
  initialPhotos,
}: LogFoodItemModalProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();
  const tz = deviceTimeZone();
  const today = ymdInTimeZone(new Date(), tz);

  const { data: config } = usePhotoConfig();
  const foodEnabled = Boolean(config?.enabled && config?.foodEnabled);
  const maxPerFoodLog = config?.maxPerFoodLog ?? 4;

  const [visitedOn, setVisitedOn] = useState<string>(today);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [tripId, setTripId] = useState<string | null>(null);
  const [rodeWith, setRodeWith] = useState<readonly string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<
    Array<{ prepared: PreparedImages; takenAt?: string }>
  >(() => (initialPhotos ? initialPhotos.map((p) => ({ prepared: p })) : []));
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { keyboardInset, getAvailableModalHeight } = useKeyboardBottomInset(visible);
  const scrollViewRef = useRef<ScrollView>(null);
  const hasInteractedWithTrip = useRef<boolean>(false);

  const experienceId = foodItem?.experienceId ?? null;
  const isCatalogRestaurant = Boolean(experienceId);

  const logsQuery = useQuery<ExperienceVisitHistoryDTO, ApiError>({
    queryKey: ['experience-logs', experienceId] as const,
    queryFn: async () => {
      const res = await apiRequest<ExperienceVisitHistoryDTO>(
        'GET',
        `/me/experiences/${encodeURIComponent(experienceId!)}/logs`,
      );
      return res ?? { experienceId: experienceId!, repeatCount: 0, logs: [] };
    },
    enabled: visible && isCatalogRestaurant,
  });

  const alreadyVisitedOnDate = useMemo(
    () => isCatalogRestaurant && hasVisitOnDate(logsQuery.data?.logs ?? [], visitedOn),
    [isCatalogRestaurant, logsQuery.data?.logs, visitedOn],
  );

  const tripsQuery = useQuery<TripsListResponse, ApiError>({
    queryKey: ['me', 'trips', 'active'] as const,
    queryFn: async () => {
      const res = await apiRequest<TripsListResponse>('GET', '/me/trips');
      return res ?? [];
    },
    enabled: visible && isCatalogRestaurant,
  });

  const activeTrips = useMemo(() => activeTripsOf(tripsQuery.data), [tripsQuery.data]);

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'] as const,
    queryFn: async () => {
      const res = await apiRequest<MeResponse>('GET', '/me');
      return res ?? { user: { id: '' } };
    },
    enabled: visible && isCatalogRestaurant,
  });

  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', tripId] as const,
    queryFn: async () => {
      const res = await apiRequest<readonly TripMemberDTO[]>(
        'GET',
        `/trips/${tripId}/members`,
      );
      return res ?? [];
    },
    enabled: visible && isCatalogRestaurant && !alreadyVisitedOnDate && Boolean(tripId),
  });

  const callerUserId = meQuery.data?.user?.id ?? '';
  const candidates = useMemo(() => {
    if (!membersQuery.data) return [];
    return ridingWithCandidates(membersQuery.data, callerUserId);
  }, [membersQuery.data, callerUserId]);

  // Preselect single active trip covering visitedOn when no restaurant visit exists yet
  useEffect(() => {
    if (visible && isCatalogRestaurant && !alreadyVisitedOnDate && !hasInteractedWithTrip.current) {
      const preselected = preselectTripId(activeTrips, visitedOn);
      if (preselected !== null) {
        setTripId(preselected);
      }
    }
  }, [visible, isCatalogRestaurant, alreadyVisitedOnDate, activeTrips, visitedOn]);

  useEffect(() => {
    if (visible && initialPhotos && initialPhotos.length > 0) {
      setSelectedPhotos(initialPhotos.map((p) => ({ prepared: p })));
    }
  }, [visible, initialPhotos]);

  const uploadPhotosMutation = useUploadPhotos();

  if (!visible || !foodItem) {
    return null;
  }

  function resetForm(): void {
    hasInteractedWithTrip.current = false;
    setVisitedOn(today);
    setRating(null);
    setNote('');
    setTripId(null);
    setRodeWith([]);
    setHint(null);
    setSelectedPhotos([]);
    setPickerVisible(false);
    setError(null);
  }

  function handleDateChange(newDate: string): void {
    const reconciled = reconcileDraft(
      { visitedOn, rating, note, tripId, rodeWith },
      { visitedOn: newDate },
      activeTrips,
      null,
    );
    setVisitedOn(reconciled.draft.visitedOn);
    setTripId(reconciled.draft.tripId);
    setRodeWith(reconciled.draft.rodeWith);
    setHint(reconciled.hint);
    if (newDate <= today && error === 'Visit date cannot be in the future') {
      setError(null);
    }
  }

  function handleTripChange(newTripId: string | null): void {
    if (busy) return;
    hasInteractedWithTrip.current = true;
    const reconciled = reconcileDraft(
      { visitedOn, rating, note, tripId, rodeWith },
      { tripId: newTripId },
      activeTrips,
      null,
    );
    setTripId(reconciled.draft.tripId);
    setRodeWith(reconciled.draft.rodeWith);
    setHint(reconciled.hint);
    if (error !== null) setError(null);
  }

  function handleToggleRider(memberUserId: string): void {
    if (busy) return;
    setRodeWith((prev) =>
      prev.includes(memberUserId)
        ? prev.filter((id) => id !== memberUserId)
        : [...prev, memberUserId],
    );
    if (error !== null) setError(null);
  }

  function handleClose(): void {
    if (busy) return;
    resetForm();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (busy) return;

    // Requirement 3.3 / 5.3: date capped at today in device timezone
    if (visitedOn > today) {
      setError('Visit date cannot be in the future');
      return;
    }

    const trimmedNote = note.trim();
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      setError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      return;
    }

    const includeTripFields = isCatalogRestaurant && !alreadyVisitedOnDate;
    const payload: CreateFoodItemLogInputDTO = {
      visitedOn,
      userTz: tz,
      rating,
      note: trimmedNote.length > 0 ? trimmedNote : null,
      ...(includeTripFields && tripId !== null ? { tripId } : {}),
      ...(includeTripFields && tripId !== null && rodeWith.length > 0
        ? { rodeWith: [...rodeWith] }
        : {}),
    };

    setBusy(true);
    setError(null);
    Keyboard.dismiss();

    try {
      const created = await apiRequest<CreateFoodItemLogResponseDTO>(
        'POST',
        `/me/food-items/${encodeURIComponent(foodItem!.id)}/logs`,
        payload,
      );

      // If photos were selected, upload them attached to the new food log (Task 13.5)
      if (selectedPhotos.length > 0) {
        await uploadPhotosMutation.mutateAsync({
          target: { kind: 'food_log', id: created.id },
          items: selectedPhotos,
        });
      }

      // Invalidate queries per Requirement 5.4 & unified-dining-logging Requirement 2.5
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', foodItem!.id],
      });
      if (foodItem?.experienceId) {
        await queryClient.invalidateQueries({
          queryKey: ['experience-food-items', foodItem.experienceId],
        });
        invalidateAfterLog(queryClient, {
          experienceId: created.restaurantVisit?.experienceId ?? foodItem.experienceId,
          tripId: created.restaurantVisit?.tripLog?.tripId ?? (includeTripFields ? tripId : null),
        });
        void queryClient.invalidateQueries({
          queryKey: ['visit-summary', foodItem.experienceId],
        });
      }
      if (foodItem?.locationId) {
        await queryClient.invalidateQueries({
          queryKey: ['location-food-items', foodItem.locationId],
        });
      }

      resetForm();
      onLogged?.(created);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'food_log_future_date') {
        setError('Visit date cannot be in the future');
      } else if (err instanceof ApiError && err.code === 'log_outside_trip_dates') {
        setError("That date is outside this trip's dates.");
      } else if (
        err instanceof ApiError &&
        (err.code === 'rate_limit_exceeded' || err.status === 429)
      ) {
        setError('Too many requests. Please wait a moment and try again.');
      } else if (err instanceof ApiError && err.code === 'photo_target_full') {
        setError('Photo limit reached for this food log.');
      } else {
        setError('Could not save log. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      testID="log-food-item-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.backdrop,
          Platform.OS === 'android' && keyboardInset > 0 ? { paddingBottom: keyboardInset } : null,
        ]}
      >
        <View
          style={[
            styles.sheet,
            Platform.OS === 'android' && keyboardInset > 0
              ? { maxHeight: getAvailableModalHeight(40) }
              : null,
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title} numberOfLines={1}>
                {foodItem.name}
              </Text>
              <Text style={styles.subtitle}>Log Dish Visit</Text>
            </View>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close log food item modal"
              style={styles.closeBtn}
              testID="close-log-food-item-btn"
            >
              <Ionicons name="close" size={24} color={t.color.textSecondary} />
            </Pressable>
          </View>

          {/* Stale item label (Requirement 5.7) */}
          {!foodItem.currentlyOnMenu && (
            <View style={styles.badgeRow}>
              <Badge
                label="Not currently on menu"
                color={t.color.textSecondary}
                testID="log-food-item-not-on-menu"
              />
            </View>
          )}

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID="log-food-item-scroll"
          >
            {error && (
              <View style={styles.errorBanner} testID="log-food-item-error">
                <Ionicons name="alert-circle" size={18} color={t.color.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Visit Date Field */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Visit Date</Text>
              <DatePickerField
                value={visitedOn}
                onChange={handleDateChange}
                maximumDate={today}
                accessibilityLabel="Visit date"
              />
              {hint === 'date_outside_trip' && (
                <Text style={styles.hintText} testID="log-food-date-hint">
                  That date is outside this trip&apos;s dates.
                </Text>
              )}
            </View>

            {/* Restaurant Visit Status & Trip / Dined-with Section (Requirements 2.1 - 2.4) */}
            {isCatalogRestaurant ? (
              alreadyVisitedOnDate ? (
                <View
                  style={styles.existingVisitBadge}
                  testID="log-food-existing-visit-badge"
                >
                  <Ionicons name="checkmark-circle" size={16} color={t.color.primaryFg} />
                  <Text style={styles.existingVisitText}>
                    ✓ Restaurant visit already logged for this date
                  </Text>
                </View>
              ) : (
                <>
                  <View
                    style={styles.autoVisitBanner}
                    testID="log-food-auto-visit-banner"
                  >
                    <Ionicons name="restaurant-outline" size={16} color={t.color.primaryFg} />
                    <Text style={styles.autoVisitBannerText}>
                      {`Also marks this restaurant as visited on ${visitedOn}`}
                    </Text>
                  </View>

                  {activeTrips.length > 0 ? (
                    <View style={styles.fieldSection} testID="log-food-trip-section">
                      <Text style={styles.fieldLabel}>Trip (optional)</Text>
                      <View style={styles.chipRow}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="No trip"
                          accessibilityState={{ selected: tripId === null, disabled: busy }}
                          disabled={busy}
                          onPress={() => handleTripChange(null)}
                          style={[
                            styles.chip,
                            tripId === null ? styles.chipSelected : null,
                          ]}
                          testID="log-food-trip-none"
                        >
                          <Text
                            style={[
                              styles.chipText,
                              tripId === null ? styles.chipTextSelected : null,
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
                              onPress={() => handleTripChange(trip.id)}
                              style={[styles.chip, selected ? styles.chipSelected : null]}
                              testID={`log-food-trip-${trip.id}`}
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

                  {tripId !== null ? (
                    <View style={styles.fieldSection} testID="log-food-rode-with-section">
                      <Text style={styles.fieldLabel}>Dined with (optional)</Text>
                      {candidates.length === 0 ? (
                        <Text style={styles.helperText} testID="log-food-no-candidates">
                          No other Members to tag yet. You can still log this on your own.
                        </Text>
                      ) : (
                        <View style={styles.chipRow}>
                          {candidates.map((member) => {
                            const selected = rodeWith.includes(member.userId);
                            return (
                              <Pressable
                                key={member.userId}
                                accessibilityRole="button"
                                accessibilityLabel={`Tag ${member.displayName}`}
                                accessibilityState={{ selected, disabled: busy }}
                                disabled={busy}
                                onPress={() => handleToggleRider(member.userId)}
                                style={[styles.chip, selected ? styles.chipSelected : null]}
                                testID={`log-food-member-${member.userId}`}
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
                  ) : null}
                </>
              )
            ) : null}

            {/* Rating Field (1-10) */}
            <View style={styles.fieldSection}>
              <View style={styles.labelWithClear}>
                <Text style={styles.fieldLabel}>
                  Rating {rating !== null ? `(${rating}/10)` : '(Optional)'}
                </Text>
                {rating !== null && (
                  <Pressable
                    onPress={() => setRating(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Clear rating"
                    testID="clear-rating-btn"
                  >
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.ratingRow}>
                {RATING_VALUES.map((val) => {
                  const isSelected = rating === val;
                  return (
                    <Pressable
                      key={val}
                      onPress={() => setRating(isSelected ? null : val)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rate ${val} out of 10`}
                      accessibilityState={{ selected: isSelected }}
                      style={[styles.ratingBtn, isSelected && styles.ratingBtnSelected]}
                      testID={`rating-btn-${val}`}
                    >
                      <Text
                        style={[
                          styles.ratingBtnText,
                          isSelected && styles.ratingBtnTextSelected,
                        ]}
                      >
                        {val}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Note Field */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Notes (Optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="How was it? What did you like?"
                placeholderTextColor={t.color.textSecondary}
                keyboardAppearance={t.scheme}
                multiline
                maxLength={MAX_NOTE_LENGTH}
                style={styles.noteInput}
                testID="log-food-item-note-input"
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollTo({ y: 180, animated: true });
                  }, 100);
                }}
              />
            </View>

            {/* Photos Section (hidden when foodEnabled is false) */}
            {foodEnabled ? (
              <View style={styles.fieldSection} testID="log-food-photos-section">
                <Text style={styles.fieldLabel}>
                  Photos ({selectedPhotos.length}/{maxPerFoodLog})
                </Text>

                {selectedPhotos.length >= maxPerFoodLog ? (
                  <Text style={styles.capExplanation} testID="log-food-photo-cap-reached">
                    Maximum {maxPerFoodLog} photos per dish visit reached.
                  </Text>
                ) : null}

                {/* Previews */}
                {selectedPhotos.length > 0 ? (
                  <View style={styles.photoThumbnailsRow}>
                    {selectedPhotos.map((item, index) => (
                      <View
                        key={index}
                        style={styles.photoThumbWrapper}
                        testID={`log-food-photo-preview-${index}`}
                      >
                        <Image
                          source={{ uri: item.prepared.thumb.uri }}
                          style={styles.photoThumb}
                          accessibilityRole="image"
                          accessibilityLabel={`Attached photo ${index + 1}`}
                        />
                        <Pressable
                          onPress={() => {
                            setSelectedPhotos((prev) => prev.filter((_, i) => i !== index));
                          }}
                          style={styles.photoRemoveBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove photo ${index + 1}`}
                          testID={`remove-photo-btn-${index}`}
                        >
                          <Ionicons name="close-circle" size={20} color={t.color.danger} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Add Photo Button */}
                <Pressable
                  disabled={selectedPhotos.length >= maxPerFoodLog}
                  onPress={() => setPickerVisible(true)}
                  style={[
                    styles.addPhotoBtn,
                    selectedPhotos.length >= maxPerFoodLog && styles.addPhotoBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedPhotos.length >= maxPerFoodLog
                      ? `Add Photo (Maximum ${maxPerFoodLog} photos reached)`
                      : 'Add Photo'
                  }
                  accessibilityState={{ disabled: selectedPhotos.length >= maxPerFoodLog }}
                  testID="log-food-add-photo-btn"
                >
                  <Ionicons
                    name="camera-outline"
                    size={20}
                    color={
                      selectedPhotos.length >= maxPerFoodLog
                        ? t.color.textSecondary
                        : t.color.primaryFg
                    }
                  />
                  <Text
                    style={[
                      styles.addPhotoBtnText,
                      selectedPhotos.length >= maxPerFoodLog && styles.addPhotoBtnTextDisabled,
                    ]}
                  >
                    Add Photo
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Action Buttons */}
            <View style={styles.actionsRow}>
              <View style={styles.actionBtn}>
                <SecondaryButton label="Cancel" onPress={handleClose} disabled={busy} />
              </View>
              <View style={styles.actionBtn}>
                <PrimaryButton
                  label={busy ? 'Saving...' : 'Save Log'}
                  onPress={() => void handleSubmit()}
                  disabled={busy}
                  testID="submit-log-food-item-btn"
                />
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <PhotoPickerSheet
        visible={pickerVisible}
        target="food"
        onClose={() => setPickerVisible(false)}
        onConfirm={(prepared, takenAt) => {
          setSelectedPhotos((prev) => [...prev, { prepared, ...(takenAt ? { takenAt } : {}) }]);
          setPickerVisible(false);
        }}
      />
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.color.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: t.color.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  badgeRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LOG_FOOD[t.scheme].errorBannerBg,
    borderRadius: t.radius.md,
    padding: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: t.color.danger,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  fieldSection: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginBottom: 8,
  },
  hintText: {
    ...t.typography.meta,
    color: t.color.accent,
    marginTop: 4,
  },
  existingVisitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  existingVisitText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textPrimary,
    flex: 1,
  },
  autoVisitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    borderRadius: t.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  autoVisitBannerText: {
    fontSize: 13,
    fontWeight: '500',
    color: t.color.textPrimary,
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  helperText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  labelWithClear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  clearText: {
    fontSize: 13,
    color: t.color.accent,
    fontWeight: '600',
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  ratingBtn: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.surfaceAlt,
  },
  ratingBtnSelected: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  ratingBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  ratingBtnTextSelected: {
    color: t.color.textOnPrimary,
  },
  noteInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    padding: 12,
    fontSize: 14,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
    textAlignVertical: 'top',
  },
  capExplanation: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: 8,
  },
  photoThumbnailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  photoThumbWrapper: {
    position: 'relative',
    width: 64,
    height: 64,
    borderRadius: t.radius.md,
    overflow: 'hidden',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
    borderRadius: t.radius.md,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: t.color.surface,
    borderRadius: 10,
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  addPhotoBtnDisabled: {
    opacity: 0.5,
  },
  addPhotoBtnText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  addPhotoBtnTextDisabled: {
    color: t.color.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
}));
