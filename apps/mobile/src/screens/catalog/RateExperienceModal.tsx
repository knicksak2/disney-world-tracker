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
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RatingDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { RATE_DIALOG } from './RateExperienceModal.palette';

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
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(RATE_DIALOG);
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
                <Ionicons name="star" size={20} color={pal.starIcon} />
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
              <Ionicons name="close" size={22} color={t.color.textSecondary} />
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
                    color={isActive ? t.color.textOnPrimary : pal.tileStar}
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
                <ActivityIndicator size="small" color={t.color.textOnPrimary} />
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

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: RATE_DIALOG[t.scheme].scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: t.color.surface,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1.5,
    borderColor: RATE_DIALOG[t.scheme].dialogBorder,
    shadowColor: RATE_DIALOG[t.scheme].dialogShadow,
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
    backgroundColor: RATE_DIALOG[t.scheme].starCircleBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: RATE_DIALOG[t.scheme].starCircleBorder,
  },
  titleTextWrapper: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: RATE_DIALOG[t.scheme].title,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  closeButton: {
    padding: 6,
    borderRadius: 16,
  },
  scoreCallout: {
    backgroundColor: RATE_DIALOG[t.scheme].calloutBg,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: RATE_DIALOG[t.scheme].calloutBorder,
  },
  scoreNumber: {
    fontSize: 26,
    fontWeight: '900',
    color: t.color.primaryFg,
  },
  scoreTen: {
    fontSize: 16,
    fontWeight: '600',
    color: RATE_DIALOG[t.scheme].scoreTen,
  },
  scoreDescription: {
    fontSize: 12.5,
    fontWeight: '700',
    color: RATE_DIALOG[t.scheme].scoreDescription,
    marginTop: 3,
  },
  scorePrompt: {
    fontSize: 13.5,
    fontWeight: '600',
    color: RATE_DIALOG[t.scheme].scorePrompt,
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
    backgroundColor: RATE_DIALOG[t.scheme].tileBg,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: RATE_DIALOG[t.scheme].tileBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pickerTileActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
    shadowColor: RATE_DIALOG[t.scheme].tileActiveShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  pickerTileText: {
    fontSize: 13,
    fontWeight: '800',
    color: RATE_DIALOG[t.scheme].tileText,
  },
  pickerTileTextActive: {
    color: t.color.textOnPrimary,
  },
  errorText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: t.color.danger,
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
    backgroundColor: t.color.primary,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: RATE_DIALOG[t.scheme].saveShadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  saveButtonText: {
    color: t.color.textOnPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  removeButton: {
    flex: 1,
    backgroundColor: RATE_DIALOG[t.scheme].removeBg,
    borderRadius: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: RATE_DIALOG[t.scheme].removeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: RATE_DIALOG[t.scheme].removeText,
    fontSize: 13,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
