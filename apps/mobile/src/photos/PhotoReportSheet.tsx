import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PhotoReportReason } from '@dwt/shared';
import { PHOTO_REPORT_REASONS } from '@dwt/shared';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { useReportPhoto } from './api';

export interface PhotoReportSheetProps {
  readonly visible: boolean;
  readonly photoId: string;
  readonly shareId?: string | undefined;
  readonly onClose: () => void;
  readonly onReported?: (() => void) | undefined;
}

const REASON_LABELS: Record<PhotoReportReason, string> = {
  inappropriate: 'Inappropriate or harmful content',
  shows_person: 'Person or face is visible',
  not_food: 'Not food or drink',
  spam: 'Spam, advertisement, or receipt',
  other: 'Other issue',
};

export function PhotoReportSheet({
  visible,
  photoId,
  shareId,
  onClose,
  onReported,
}: PhotoReportSheetProps) {
  const styles = useStyles();
  const t = useAppTheme();
  const reportMutation = useReportPhoto();

  const [selectedReason, setSelectedReason] = useState<PhotoReportReason>('not_food');
  const [note, setNote] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    try {
      setErrorMessage(null);
      await reportMutation.mutateAsync({
        photoId,
        reason: selectedReason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(shareId ? { shareId } : {}),
      });
      setIsSubmitted(true);
      if (onReported) {
        onReported();
      }
    } catch (err: any) {
      setErrorMessage(err?.message ?? 'Failed to submit report. Please try again.');
    }
  };

  const handleClose = () => {
    setIsSubmitted(false);
    setErrorMessage(null);
    setNote('');
    setSelectedReason('not_food');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet} testID="photo-report-sheet">
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Report Photo
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close report dialog"
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color={t.color.textSecondary} />
            </TouchableOpacity>
          </View>

          {isSubmitted ? (
            <View style={styles.confirmationContainer} testID="photo-report-confirmation">
              <Ionicons name="checkmark-circle" size={48} color={t.color.success} />
              <Text style={styles.confirmationTitle}>Report Submitted</Text>
              <Text style={styles.confirmationBody}>
                Thank you for helping keep the community safe. Our team will review this photo.
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView style={styles.scrollContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionHeading}>Why are you reporting this photo?</Text>

              {PHOTO_REPORT_REASONS.map((reason) => {
                const isSelected = selectedReason === reason;
                return (
                  <TouchableOpacity
                    key={reason}
                    testID={`report-reason-${reason}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={REASON_LABELS[reason]}
                    style={[styles.reasonRow, isSelected && styles.reasonRowSelected]}
                    onPress={() => setSelectedReason(reason)}
                  >
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? t.color.primaryFg : t.color.textSecondary}
                    />
                    <Text style={[styles.reasonLabel, isSelected && styles.reasonLabelSelected]}>
                      {REASON_LABELS[reason]}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <Text style={styles.sectionHeading}>Additional note (optional)</Text>
              <TextInput
                testID="report-note-input"
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Provide additional details (optional)"
                placeholderTextColor={t.color.textSecondary}
                maxLength={200}
                multiline
                accessibilityLabel="Additional note for report"
              />

              {errorMessage ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                  {errorMessage}
                </Text>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  onPress={handleClose}
                  style={styles.cancelButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel report"
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  testID="submit-report-button"
                  onPress={handleSubmit}
                  disabled={reportMutation.isPending}
                  style={[styles.primaryButton, reportMutation.isPending && styles.buttonDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Submit report"
                >
                  {reportMutation.isPending ? (
                    <ActivityIndicator size="small" color={t.color.textOnPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Submit Report</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    maxHeight: '85%',
    paddingBottom: t.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  title: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  closeButton: {
    padding: t.spacing.xs,
  },
  scrollContent: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.md,
  },
  sectionHeading: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.xs,
  },
  reasonRowSelected: {
    backgroundColor: t.color.surfaceAlt,
  },
  reasonLabel: {
    ...t.typography.body,
    color: t.color.textPrimary,
    marginLeft: t.spacing.sm,
  },
  reasonLabelSelected: {
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  noteInput: {
    ...t.typography.body,
    color: t.color.textPrimary,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    height: 80,
    textAlignVertical: 'top',
    marginBottom: t.spacing.md,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
    marginBottom: t.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: t.spacing.sm,
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.lg,
  },
  cancelButton: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  cancelButtonText: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  primaryButton: {
    backgroundColor: t.color.primary,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
  confirmationContainer: {
    padding: t.spacing.lg,
    alignItems: 'center',
  },
  confirmationTitle: {
    ...t.typography.heading,
    color: t.color.textPrimary,
    marginTop: t.spacing.md,
    marginBottom: t.spacing.sm,
  },
  confirmationBody: {
    ...t.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
    marginBottom: t.spacing.lg,
  },
}));
