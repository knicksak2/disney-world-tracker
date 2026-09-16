// Feature: food-item-logging, Task 7.2 & 7.5 — Log Food Item Modal
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4, 5.7

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';

import type { CreateFoodItemLogInputDTO, FoodItemDTO, FoodItemLogDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { theme } from '../../theme/theme';
import { Badge, PrimaryButton, SecondaryButton } from '../../theme/components';

export interface LogFoodItemModalProps {
  /** The food item being logged. */
  readonly foodItem: FoodItemDTO | null;
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without logging. */
  readonly onClose: () => void;
  /** Callback after a successful log creation. */
  readonly onLogged?: (log: FoodItemLogDTO) => void;
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
}: LogFoodItemModalProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const tz = deviceTimeZone();
  const today = ymdInTimeZone(new Date(), tz);

  const [visitedOn, setVisitedOn] = useState<string>(today);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible || !foodItem) {
    return null;
  }

  function resetForm(): void {
    setVisitedOn(today);
    setRating(null);
    setNote('');
    setError(null);
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

    const payload: CreateFoodItemLogInputDTO = {
      visitedOn,
      userTz: tz,
      rating,
      note: trimmedNote.length > 0 ? trimmedNote : null,
    };

    setBusy(true);
    setError(null);

    try {
      const created = await apiRequest<FoodItemLogDTO>(
        'POST',
        `/me/food-items/${encodeURIComponent(foodItem!.id)}/logs`,
        payload,
      );

      // Invalidate queries per Requirement 5.4
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', foodItem!.id],
      });
      if (foodItem?.experienceId) {
        await queryClient.invalidateQueries({
          queryKey: ['experience-food-items', foodItem.experienceId],
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
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
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
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Stale item label (Requirement 5.7) */}
          {!foodItem.currentlyOnMenu && (
            <View style={styles.badgeRow}>
              <Badge
                label="Not currently on menu"
                color={theme.color.textSecondary}
                testID="log-food-item-not-on-menu"
              />
            </View>
          )}

          <ScrollView contentContainerStyle={styles.content}>
            {error && (
              <View style={styles.errorBanner} testID="log-food-item-error">
                <Ionicons name="alert-circle" size={18} color={theme.color.danger} />
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
                placeholderTextColor={theme.color.textSecondary}
                multiline
                maxLength={MAX_NOTE_LENGTH}
                style={styles.noteInput}
                testID="log-food-item-note-input"
              />
            </View>

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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
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
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
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
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: theme.radius.md,
    padding: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    color: theme.color.danger,
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
    color: theme.color.textPrimary,
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
    color: theme.color.accent,
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
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
  },
  ratingBtnSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  ratingBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  ratingBtnTextSelected: {
    color: theme.color.textOnPrimary,
  },
  noteInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: 12,
    fontSize: 14,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
    textAlignVertical: 'top',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
