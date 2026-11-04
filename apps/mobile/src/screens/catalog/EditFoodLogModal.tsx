// Feature: food-item-logging — Edit Food Log Modal
//
// Validates: Requirements 4.5, 4.7, 5.11, 8.11, 9.9, Property 14

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
import { useQueryClient } from '@tanstack/react-query';

import type { FoodItemLogDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { PrimaryButton, SecondaryButton } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { useKeyboardBottomInset } from '../../hooks/useKeyboardBottomInset';
import { EDIT_FOOD } from './EditFoodLogModal.palette';
import { useDeletePhoto, useMyPhotos, usePhotoConfig, useUploadPhotos } from '../../photos/api';
import { PhotoPickerSheet } from '../../photos/PhotoPickerSheet';
import type { PreparedImages } from '../../photos/imagePrep';

export interface EditableFoodLogTarget {
  readonly id: string;
  readonly foodItemId: string;
  readonly foodItemName?: string;
  readonly restaurantName?: string | null;
  readonly locationName?: string | null;
  readonly visitedOn: string;
  readonly userTz?: string;
  readonly rating: number | null;
  readonly note: string | null;
}

export interface EditFoodLogModalProps {
  /** The food log entry being edited. */
  readonly log: EditableFoodLogTarget | null;
  /** Whether the modal is visible. */
  readonly visible: boolean;
  /** Dismiss the modal without saving. */
  readonly onClose: () => void;
  /** Callback after a successful update. */
  readonly onUpdated?: (log: FoodItemLogDTO) => void;
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

export default function EditFoodLogModal({
  log,
  visible,
  onClose,
  onUpdated,
}: EditFoodLogModalProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();
  const tz = deviceTimeZone();
  const today = ymdInTimeZone(new Date(), tz);

  const { data: config } = usePhotoConfig();
  const foodEnabled = Boolean(config?.enabled && config?.foodEnabled);
  const maxPerFoodLog = config?.maxPerFoodLog ?? 4;

  const [visitedOn, setVisitedOn] = useState<string>(log?.visitedOn ?? today);
  const [rating, setRating] = useState<number | null>(log?.rating ?? null);
  const [note, setNote] = useState<string>(log?.note ?? '');
  const [selectedNewPhotos, setSelectedNewPhotos] = useState<
    Array<{ prepared: PreparedImages; takenAt?: string }>
  >([]);
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<Set<string>>(new Set());
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { keyboardInset, getAvailableModalHeight } = useKeyboardBottomInset(visible);
  const scrollViewRef = useRef<ScrollView>(null);

  // Sync state whenever `log` or `visible` changes
  useEffect(() => {
    if (visible && log) {
      setVisitedOn(log.visitedOn);
      setRating(log.rating);
      setNote(log.note ?? '');
      setSelectedNewPhotos([]);
      setDeletedPhotoIds(new Set());
      setPickerVisible(false);
      setError(null);
    }
  }, [visible, log]);

  // Existing photos for this dish, filtered to this log and excluding deletions
  const { data: photoData } = useMyPhotos('food_log', log?.foodItemId ?? '');
  const existingPhotos = useMemo(() => {
    if (!log) return [];
    return (photoData?.items ?? []).filter(
      (p) => p.targetId === log.id && !deletedPhotoIds.has(p.id),
    );
  }, [photoData?.items, log, deletedPhotoIds]);

  const totalPhotoCount = existingPhotos.length + selectedNewPhotos.length;
  const isCapReached = totalPhotoCount >= maxPerFoodLog;

  const uploadPhotosMutation = useUploadPhotos();
  const deletePhotoMutation = useDeletePhoto();

  if (!visible || !log) {
    return null;
  }

  const placeName = log.restaurantName ?? log.locationName;

  function handleClose(): void {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (busy || !log) return;

    if (visitedOn > today) {
      setError('Visit date cannot be in the future');
      return;
    }

    const trimmedNote = note.trim();
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      setError(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      return;
    }

    setBusy(true);
    setError(null);
    Keyboard.dismiss();

    try {
      const updated = await apiRequest<FoodItemLogDTO>(
        'PATCH',
        `/me/food-items/${encodeURIComponent(log.foodItemId)}/logs/${encodeURIComponent(log.id)}`,
        {
          visitedOn,
          userTz: tz,
          rating,
          note: trimmedNote.length > 0 ? trimmedNote : null,
        },
      );

      // Perform any photo deletions
      if (deletedPhotoIds.size > 0) {
        await Promise.all(
          Array.from(deletedPhotoIds).map((photoId) => deletePhotoMutation.mutateAsync(photoId)),
        );
      }

      // Upload newly attached photos
      if (selectedNewPhotos.length > 0) {
        await uploadPhotosMutation.mutateAsync({
          target: { kind: 'food_log', id: log.id },
          items: selectedNewPhotos,
        });
      }

      // Invalidate relevant queries
      await queryClient.invalidateQueries({
        queryKey: ['me-food-item-logs'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', log.foodItemId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['scoped-food-item-logs'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['photos', 'food_log', log.foodItemId],
      });

      onUpdated?.(updated);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'food_log_future_date') {
        setError('Visit date cannot be in the future');
      } else if (
        err instanceof ApiError &&
        (err.code === 'rate_limit_exceeded' || err.status === 429)
      ) {
        setError('Too many requests. Please wait a moment and try again.');
      } else if (err instanceof ApiError && err.code === 'photo_target_full') {
        setError('Photo limit reached for this food log.');
      } else {
        setError('Could not update log. Please try again.');
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
      testID="edit-food-log-modal"
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
                {log.foodItemName ?? 'Dish Log'}
              </Text>
              <Text style={styles.subtitle}>
                {placeName ? `Edit Log · ${placeName}` : 'Edit Dish Visit'}
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close edit food log modal"
              style={styles.closeBtn}
              testID="close-edit-food-log-btn"
            >
              <Ionicons name="close" size={24} color={t.color.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            testID="edit-food-log-scroll"
          >
            {error && (
              <View style={styles.errorBanner} testID="edit-food-log-error">
                <Ionicons name="alert-circle" size={18} color={t.color.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Visit Date Field */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Visit Date</Text>
              <DatePickerField
                value={visitedOn}
                onChange={(newDate) => {
                  setVisitedOn(newDate);
                  if (newDate <= today && error === 'Visit date cannot be in the future') {
                    setError(null);
                  }
                }}
                maximumDate={today}
                accessibilityLabel="Visit date"
              />
            </View>

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
                    testID="edit-clear-rating-btn"
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
                      testID={`edit-rating-btn-${val}`}
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
                testID="edit-food-log-note-input"
                onFocus={() => {
                  setTimeout(() => {
                    scrollViewRef.current?.scrollTo({ y: 180, animated: true });
                  }, 100);
                }}
              />
            </View>

            {/* Photos Section */}
            {foodEnabled ? (
              <View style={styles.fieldSection} testID="edit-food-photos-section">
                <Text style={styles.fieldLabel}>
                  Photos ({totalPhotoCount}/{maxPerFoodLog})
                </Text>

                {isCapReached ? (
                  <Text style={styles.capExplanation} testID="edit-food-photo-cap-reached">
                    Maximum {maxPerFoodLog} photos per dish visit reached.
                  </Text>
                ) : null}

                {/* Previews of existing + newly selected photos */}
                {totalPhotoCount > 0 ? (
                  <View style={styles.photoThumbnailsRow}>
                    {existingPhotos.map((photo) => (
                      <View
                        key={photo.id}
                        style={styles.photoThumbWrapper}
                        testID={`edit-food-photo-existing-${photo.id}`}
                      >
                        <Image
                          source={{ uri: (photo.thumbUrl || photo.url) ?? undefined }}
                          style={styles.photoThumb}
                          accessibilityRole="image"
                          accessibilityLabel="Existing photo"
                        />
                        <Pressable
                          onPress={() => {
                            setDeletedPhotoIds((prev) => new Set(prev).add(photo.id));
                          }}
                          style={styles.photoRemoveBtn}
                          accessibilityRole="button"
                          accessibilityLabel="Delete this photo"
                          testID={`remove-existing-photo-${photo.id}`}
                        >
                          <Ionicons name="close-circle" size={20} color={t.color.danger} />
                        </Pressable>
                      </View>
                    ))}
                    {selectedNewPhotos.map((item, index) => (
                      <View
                        key={`new-${index}`}
                        style={styles.photoThumbWrapper}
                        testID={`edit-food-photo-preview-${index}`}
                      >
                        <Image
                          source={{ uri: item.prepared.thumb.uri }}
                          style={styles.photoThumb}
                          accessibilityRole="image"
                          accessibilityLabel={`New photo ${index + 1}`}
                        />
                        <Pressable
                          onPress={() => {
                            setSelectedNewPhotos((prev) => prev.filter((_, i) => i !== index));
                          }}
                          style={styles.photoRemoveBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove new photo ${index + 1}`}
                          testID={`remove-new-photo-${index}`}
                        >
                          <Ionicons name="close-circle" size={20} color={t.color.danger} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Add Photo Button */}
                <Pressable
                  disabled={isCapReached}
                  onPress={() => setPickerVisible(true)}
                  style={[
                    styles.addPhotoBtn,
                    isCapReached && styles.addPhotoBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isCapReached
                      ? `Add Photo (Maximum ${maxPerFoodLog} photos reached)`
                      : 'Add Photo'
                  }
                  accessibilityState={{ disabled: isCapReached }}
                  testID="edit-food-add-photo-btn"
                >
                  <Ionicons
                    name="camera-outline"
                    size={20}
                    color={isCapReached ? t.color.textSecondary : t.color.primaryFg}
                  />
                  <Text
                    style={[
                      styles.addPhotoBtnText,
                      isCapReached && styles.addPhotoBtnTextDisabled,
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
                  label={busy ? 'Saving...' : 'Save Changes'}
                  onPress={() => void handleSubmit()}
                  disabled={busy}
                  testID="submit-edit-food-log-btn"
                />
              </View>
            </View>
          </ScrollView>

          {/* Photo Picker Sheet */}
          {foodEnabled && (
            <PhotoPickerSheet
              visible={pickerVisible}
              target="food"
              onClose={() => setPickerVisible(false)}
              onConfirm={(prepared, takenAt) => {
                setSelectedNewPhotos((prev) => [
                  ...prev,
                  { prepared, ...(takenAt ? { takenAt } : {}) },
                ]);
                setPickerVisible(false);
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
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
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
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
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: EDIT_FOOD[t.scheme].errorBannerBg,
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
    width: 72,
    height: 72,
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
    borderRadius: 12,
    backgroundColor: t.color.surface,
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
    fontSize: 14,
    fontWeight: '600',
    color: t.color.primaryFg,
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
