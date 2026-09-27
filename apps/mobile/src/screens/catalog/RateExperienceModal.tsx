// Feature: experience-detail-redesign — RateExperienceModal
//
// Allows rating an experience (1..10 stars) or removing an existing rating.
// Invoked by the FloatingActionDock's "Rate visit" button on the Passport lens.
// Calls PUT /me/experiences/:id/rating or DELETE /me/experiences/:id/rating.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RatingDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface RateExperienceModalProps {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly visible: boolean;
  readonly currentRating: number | null;
  readonly onClose: () => void;
  readonly onRated: () => void;
}

const RATING_DESCRIPTIONS: Record<number, string> = {
  10: 'Perfection! Must-do classic',
  9: 'Exceptional / Top tier',
  8: 'Great experience',
  7: 'Good fun / Solid ride',
  6: 'Decent, worth checking out',
  5: 'Average park experience',
  4: 'Underwhelming',
  3: 'Needs improvement',
  2: 'Disappointing',
  1: 'Skip it',
};

export default function RateExperienceModal({
  experienceId,
  experienceName,
  visible,
  currentRating,
  onClose,
  onRated,
}: RateExperienceModalProps): JSX.Element {
  const [selectedRating, setSelectedRating] = useState<number | null>(currentRating);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelectedRating(currentRating);
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [visible, currentRating]);

  const handleSave = async (): Promise<void> => {
    if (selectedRating === null) {
      setErrorMessage('Please select a rating between 1 and 10.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await apiRequest<RatingDTO>(
        'PUT',
        `/me/experiences/${encodeURIComponent(experienceId)}/rating`,
        { rating: selectedRating },
      );
      onRated();
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.message : 'Could not save rating. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await apiRequest<null>(
        'DELETE',
        `/me/experiences/${encodeURIComponent(experienceId)}/rating`,
      );
      onRated();
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError ? err.message : 'Could not remove rating. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="rate-experience-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleContainer}>
              <View style={styles.iconCircle}>
                <Ionicons name="star" size={20} color="#e5a100" />
              </View>
              <View style={styles.titleTextWrapper}>
                <Text style={styles.title}>Rate Experience</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {experienceName}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.closeButton}
              testID="close-rate-modal"
            >
              <Ionicons name="close" size={22} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Current Score Callout */}
          <View style={styles.scoreCallout}>
            {selectedRating !== null ? (
              <>
                <Text style={styles.scoreNumber} testID="selected-rating-display">
                  ★ {selectedRating} <Text style={styles.scoreTen}>/ 10</Text>
                </Text>
                <Text style={styles.scoreDescription}>
                  {RATING_DESCRIPTIONS[selectedRating] ?? ''}
                </Text>
              </>
            ) : (
              <Text style={styles.scorePrompt}>
                Tap a star below to set your rating
              </Text>
            )}
          </View>

          {/* 1..10 Star Selectors */}
          <View style={styles.pickerGrid}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
              const isActive = selectedRating === num;
              return (
                <Pressable
                  key={num}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${num} out of 10`}
                  onPress={() => setSelectedRating(num)}
                  style={[
                    styles.pickerTile,
                    isActive && styles.pickerTileActive,
                  ]}
                  testID={`rating-tile-${num}`}
                >
                  <Ionicons
                    name={isActive ? 'star' : 'star-outline'}
                    size={16}
                    color={isActive ? '#ffffff' : '#7b6899'}
                  />
                  <Text
                    style={[
                      styles.pickerTileText,
                      isActive && styles.pickerTileTextActive,
                    ]}
                  >
                    {num}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Error Message */}
          {errorMessage ? (
            <Text style={styles.errorText} testID="rate-error-text">
              {errorMessage}
            </Text>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save Rating"
              disabled={isSubmitting || selectedRating === null}
              onPress={() => {
                void handleSave();
              }}
              style={[
                styles.saveButton,
                (isSubmitting || selectedRating === null) && styles.buttonDisabled,
              ]}
              testID="save-rating-button"
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Rating</Text>
              )}
            </Pressable>

            {currentRating !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove Rating"
                disabled={isSubmitting}
                onPress={() => {
                  void handleRemove();
                }}
                style={[styles.removeButton, isSubmitting && styles.buttonDisabled]}
                testID="remove-rating-button"
              >
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 8, 36, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(230, 222, 242, 0.95)',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff8e6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fce299',
  },
  titleTextWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#371756',
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
  },
  scoreCallout: {
    backgroundColor: '#faf8fd',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#ede5f7',
  },
  scoreNumber: {
    fontSize: 26,
    fontWeight: '900',
    color: '#5b2a86',
  },
  scoreTen: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8b7aa3',
  },
  scoreDescription: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#655082',
    marginTop: 3,
  },
  scorePrompt: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#7b6899',
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  pickerTile: {
    width: '18%',
    aspectRatio: 1,
    backgroundColor: '#fbf9fe',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2d7f2',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pickerTileActive: {
    backgroundColor: '#5b2a86',
    borderColor: '#5b2a86',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  pickerTileText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#49236d',
  },
  pickerTileTextActive: {
    color: '#ffffff',
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: theme.color.danger,
    textAlign: 'center',
    marginBottom: 12,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  saveButton: {
    flex: 2,
    backgroundColor: '#5b2a86',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5b2a86',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  removeButton: {
    flex: 1,
    backgroundColor: '#fff0f3',
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: '#ffd0da',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#d32f2f',
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
